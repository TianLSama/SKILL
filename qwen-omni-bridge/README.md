# Qwen 全模态桥接（qwen-omni-bridge）

把音频、视频模态的输入路由到 **qwen3.8-omni-flash**，把文字结果返回给主模型（DeepSeek Harness 中的 deepseek-flash），让主模型能够“理解”音视频。提供两种使用方式：

1. **按需调用**：注册 `omni_media` 工具。主模型遇到音视频文件时可以主动调用，传入路径和问题，拿到转写/画面描述/问答结果。
2. **自动路由**：用户上传音视频附件时，`agent/pre-step` 钩子先调用 qwen3.8-omni-flash 解析，然后在原用户消息之后插入一条来源为 `qwen-omni-bridge` 的上下文消息（内容为 `<omni-media-analysis>`）。主模型在同一步就能看到内容，无需再自行决定是否调用工具。

插件是 Host-only、零 `@deepseek-ai/*` 依赖的 bundle，只使用 Node 内置模块。

## 接入点与模型

| 项 | 值 |
| --- | --- |
| Base URL | `https://ws-srp61mkj9bp9w0ct.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| 模型 | `qwen3.8-omni-flash` |
| 协议 | OpenAI 兼容 `POST /chat/completions`，`modalities: ["text"]` |
| API Key | 默认读取 `ALIYUN_API_KEY`，其次 `DASHSCOPE_API_KEY` |

API Key 解析顺序：

1. 当前进程环境变量；
2. Windows 用户环境变量（`HKCU\Environment`）。有些环境在 DSH 启动后才设置用户变量，此时进程环境里没有、注册表里已有，插件仍能读到。

密钥不会出现在日志或工具输出中。

## 安装

在 DSH 中通过插件管理器安装本目录：

```text
plugin_manager install_bundle  target = E:\Work\coding\SKILL\qwen-omni-bridge
```

安装后 bundle 会写入当前 profile，并在 Host 插件树中插入 `qwen-omni-bridge` 行。无需重启；新会话即可看到 `omni_media` 工具。可用 `cordis_inspect_query` 的 `Config.listConfigs` / `Tool.listTools` 确认激活。

## 配置

`cordis.patch.yml` 已给出推荐默认值。可通过覆盖该行的 `config` 调整：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | 上述接入点 | OpenAI 兼容接口根地址 |
| `model` | `qwen3.8-omni-flash` | 模型名 |
| `apiKeyEnv` | `[ALIYUN_API_KEY, DASHSCOPE_API_KEY]` | 依次尝试的环境变量名 |
| `reasoningEffort` | `low` | `none`/`low`/`medium`/`xhigh`；默认思考强度 |
| `autoAnalyzeAttachments` | `true` | 是否自动解析用户上传的音视频附件 |
| `autoAnalyzeMaxBytes` | `8000000` | 超过此大小不自动解析，改为提示调用工具 |
| `autoAnalyzeTimeoutMs` | `120000` | 自动解析超时 |
| `autoMaxOutputChars` | `12000` | 自动解析结果写入消息的最大字符数 |
| `maxOutputChars` | `40000` | 工具结果最大字符数 |
| `timeoutMs` | `600000` | 工具调用超时 |
| `allowOutsideWorkspace` | `false` | 是否允许工具读取工作区和 DSH 附件目录之外的路径 |
| `ffmpegPath` / `ffprobePath` | `ffmpeg` / `ffprobe` | 转码工具路径 |
| `maxSegments` | `12` | 单个媒体最多切分段数 |
| `debug` | `false` | 打印请求耗时、密钥来源等调试日志（不含密钥） |

## 使用

### 主模型按需调用

```text
omni_media(
  paths: ["E:\\videos\\meeting.mp4"],
  prompt: "逐字转写会议内容，并按发言人整理待办事项。"
)
```

工具返回：

```text
[qwen3.8-omni-flash] 视频 E:\videos\meeting.mp4

（模型输出：概述、时间线、屏幕文字、语音转写……）
```

支持一次传多个文件；支持 `http(s)` 公网 URL（服务端直接拉取，不受 10MB Base64 限制）。

### 自动路由

用户直接在聊天框上传 `.mp3` / `.wav` / `.m4a` / `.mp4` / `.mov` / `.mkv` 等文件并提问。插件在模型请求前完成解析，并在用户消息之后插入一条上下文消息：

```xml
<omni-media-analysis file="meeting.mp4" attachment="..." kind="video" model="qwen3.8-omni-flash">
（概述、时间线、画面文字、语音转写、声音事件……）
</omni-media-analysis>
```

主模型下一步直接基于这段文字回答。解析失败会写入 `<omni-media-analysis-error>`，不会阻断整个回合；文件过大则写入 `<omni-media-note>`，提示模型按需调用 `omni_media`。

## 媒体处理细节

DashScope 的 OpenAI 兼容接口对 Base64 媒体有两个约束：

- 音频/视频必须是 `data:;base64,<数据>`（不带 MIME），图片是 `data:image/png;base64,...`；
- 编码后的 Base64 字符串必须小于 10MB。

因此插件：

- 原始文件 ≤ 7MB 且格式受支持：直接内联，不二次编码；
- 更大的文件或 `.m4a`/`.webm`/`.flac` 等容器：调用 ffmpeg 转码；
  - 音频转 24kHz 单声道 56kbps MP3，每段 15 分钟；
  - 视频转 480p/540p/720p、2fps、H.264 + 48kbps AAC，每段 4 分钟；
  - 每段单独控制在 7MB 内；超过时降档重试；
  - 最多 12 段；超长媒体会提示先裁剪。
- 分段后在同一请求里按“第 i/N 段”标注传入，模型仍然可以跨段综合。
- 临时文件写入系统临时目录，调用结束立即删除。

格式支持：

- 音频：`wav`、`mp3`、`aac`、`amr`、`3gp`（其余转 MP3）
- 视频：`mp4`、`avi`、`mkv`、`mov`、`flv`、`wmv`（其余转 MP4）
- 图片：`png`、`jpg`、`webp`、`gif`

## 安全边界

- `omni_media` 默认只允许读取：
  - 当前会话工作目录内的文件；
  - DSH 附件目录（`<DSH_HOME>/attachments`）内的文件。
- 其他绝对路径会被拒绝；确需读取时显式设置 `allowOutsideWorkspace: true`。
- 自动路由只处理 `attachment` 服务提供的附件路径，不扫描磁盘。
- 模型通过工具发送到阿里云的内容仅限用户指定/上传的媒体文件。

## 验证记录

在 Windows + DSH 0.2.1-rc.2 环境下已验证：

- 接入点 `GET /models` 可列出 `qwen3.8-omni-flash`；API Key 有效。
- 8 秒中文 TTS WAV：逐字转写与语气判断正确，耗时约 2.8 秒，`reasoning_effort: none`。
- 4 秒 MP4（蓝色背景 + 两行中文）：画面描述与 OCR 正确，耗时约 1.6 秒，`video_tokens` 正常计费。
- 非流式请求 `stream: false` 可用，响应为 `choices[0].message.content` 字符串。
- 插件安装后 `omni_media` 工具可见；通过子代理实际调用可返回转写/描述结果。

未完成/受限验证：

- 自动路由的完整 Web UI 上传链路需要真实上传附件；已用单元方式验证 pre-step 消息注入逻辑（真实 API + 假 ctx），端到端上传未在无浏览器控制的情况下验证。
- 超长视频（> 48 分钟）会触发分段上限并提示裁剪，未做长视频质量评估。

## 文件结构

```text
qwen-omni-bridge/
├─ index.js                 # Loader 入口（零 @deepseek-ai/* 依赖）
├─ lib/
│  ├─ plugin.js             # 工具注册、pre-step 自动路由、系统提示
│  ├─ config.js             # 配置归一化
│  ├─ key.js                # 环境变量 / HKCU 密钥解析
│  ├─ api.js                # OpenAI 兼容 Chat Completions 客户端
│  ├─ analyze.js            # 路径解析、提示词、结果截断
│  └─ media.js              # 类型识别、Base64、ffmpeg 转码与分段
├─ cordis.patch.yml         # bundle patch
├─ locale/{zh,en}.json      # 插件管理器显示元数据
├─ icon.svg
└─ test/                    # 本地冒烟测试
```
