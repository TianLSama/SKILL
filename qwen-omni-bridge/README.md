# Qwen 全模态桥接（qwen-omni-bridge）

把音频、视频模态的输入路由到 **qwen3.8-omni-flash**，把文字结果返回给主模型（DeepSeek Harness 中的 deepseek-flash），让主模型能够“理解”音视频。提供两种使用方式：

1. **按需调用**：注册 `omni_media` 工具。主模型遇到音视频文件时主动调用，传入路径和问题，拿到转写/画面描述/问答结果。
2. **自动路由**：用户上传音视频附件时，`agent/pre-step` 钩子先调用 qwen3.8-omni-flash 解析，然后在原用户消息之后插入一条来源为 `qwen-omni-bridge` 的上下文消息（内容为 `<omni-media-analysis>`）。主模型在同一步就能看到内容。

插件是 Host-only bundle，唯一外部依赖是 `@deepseek-ai/schemastery`（用于插件管理页面的配置表单）。

## 职责分工（omni-only，固定策略）

- **外部模型负责感知**：所有音频、视频内容——语音转写、说话人、声音事件、画面、人物动作、屏幕文字、公式、图表、曲线、镜头变化——都由 `qwen3.8-omni-flash` 通过 `omni_media` 理解。
- **主模型负责调度与整合**：理解用户意图、拆分问题、决定让 omni 看/听哪一段、整合结果并回答。
- **禁止**用 `ffmpeg` 抽帧 + `read_image`、截图 OCR 或其他主模型视觉方式替代视频理解。用户直接提供的静态图片仍可直接读取；但“从视频中提取的帧/截图”属于视频理解，必须交给 `omni_media`。
- 该策略固定为 `mediaPolicy: omni-only`，同时写入插件系统提示和 DSH 全局 `AGENTS.md`；插件管理页面的配置页也会显示策略提示。

## 接入点与模型

接入点、模型名等由使用者在插件管理页或部署配置中填写；仓库只保留占位示例，不记录真实接入点。

| 项 | 值 |
| --- | --- |
| Base URL | `https://<workspace-id>.<region>.maas.aliyuncs.com/compatible-mode/v1`（占位示例，按实际填写） |
| Base URL 环境变量 | `ALIYUN_BASE_URL`（页面未填写时回退） |
| 模型 | `qwen3.8-omni-flash` |
| 协议 | OpenAI 兼容 `POST /chat/completions`，`modalities: ["text"]` |
| 默认 Key 环境变量 | `ALIYUN_API_KEY`，其次 `DASHSCOPE_API_KEY` |

接入点解析顺序：插件管理页/配置中的 `baseURL` → 环境变量 `ALIYUN_BASE_URL`。两者都为空时，`omni_media` 会返回明确的“未配置接入点”错误，不会请求默认地址。

## API Key 解析顺序

1. **插件管理页面填写的 API Key**（`apiKey` 非空时优先使用）；
2. 环境变量 `ALIYUN_API_KEY`（或页面配置的 `apiKeyEnv`）；
3. 环境变量 `DASHSCOPE_API_KEY`；
4. Windows 用户环境变量（`HKCU\Environment`）。有些环境在 DSH 启动后才设置用户变量，此时进程环境里没有、注册表里已有，插件仍能读到。

页面上的 API Key 留空即表示“使用环境变量”。密钥不会出现在日志、调试输出或工具结果中。

## 安装与运行位置

为避免工作区路径变化导致插件无法加载，运行时使用 DSH 目录下的独立副本：

| 用途 | 路径 |
| --- | --- |
| 开发源码 | 本仓库的 `qwen-omni-bridge/` 目录 |
| DSH 运行时副本 | `%USERPROFILE%\.dsh\plugins\qwen-omni-bridge` |

安装时指向运行时副本，而不是工作区：

```text
plugin_manager install_bundle  target = %USERPROFILE%\.dsh\plugins\qwen-omni-bridge
```

其中 `%USERPROFILE%` 展开为当前 Windows 用户目录。

bundle patch 中的 `baseURL` 默认为空，首次安装后需要在插件管理页填写，或设置环境变量 `ALIYUN_BASE_URL`。

安装后 bundle 会写入当前 profile，并在 Host 插件树中插入 `qwen-omni-bridge` 行。无需重启；新会话即可看到 `omni_media` 工具。可用 `cordis_inspect_query` 的 `Config.listConfigs` / `Tool.listTools` 确认激活。

更新插件时，把源码同步到运行时副本后重新安装：

```powershell
pwsh -File scripts\sync-to-dsh.ps1
# 然后在 DSH 里重新 install_bundle 指向运行时副本
```

## 插件管理页面配置

安装后打开 DSH 的「插件」页，进入 **Qwen 全模态桥接** 的包详情。配置可用时，「包含的组件」中该组件行的标题会变成带 `›` 的按钮；点击标题即可进入配置页。若刚安装完标题还不可点击，刷新一次页面（建议 Ctrl+Shift+R）以加载插件的 Client 端配置页；仍不行则重启一次 DSH。

页面表单字段使用 Schemastery `volatile`，修改后在下一次工具调用或 `pre-step` 时生效。

| 页面字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | 空 | OpenAI 兼容接口根地址；首次使用需填写，或设置环境变量 `ALIYUN_BASE_URL` |
| `apiKey` | 空 | API Key；留空则读取环境变量；已配置时留空保持不变 |
| `model` | `qwen3.8-omni-flash` | 模型名 |
| `reasoningEffort` | `low` | `none`/`low`/`medium`/`xhigh` |
| `autoAnalyzeAttachments` | `true` | 是否自动解析用户上传的音视频附件 |
| `allowOutsideWorkspace` | `false` | 是否允许工具读取工作区和 DSH 附件目录之外的路径 |
| `debug` | `false` | 打印调试日志（不含密钥） |

以下高级字段在 Host `Config` schema 中仍可配置，但当前页面表单未渲染，可通过 `cordis.patch.yml` 或插件行配置覆盖：

`apiKeyEnv`、`autoAnalyzeMaxBytes`、`autoAnalyzeTimeoutMs`、`autoMaxOutputChars`、`maxOutputChars`、`timeoutMs`、`maxSegments`、`ffmpegPath`、`ffprobePath`。

`mediaPolicy` 固定为 `omni-only`；配置为其他值会在插件激活时被拒绝。配置页顶部会显示策略提示。

`cordis.patch.yml` 中给出了同样的默认值；插件管理页面的修改会作为 profile 覆盖层保存。

## 使用

### 主模型按需调用

```text
omni_media(
  paths: ["D:\\media\\meeting.mp4"],
  prompt: "逐字转写会议内容，并按发言人整理待办事项。"
)
```

工具返回：

```text
[qwen3.8-omni-flash] 视频 D:\media\meeting.mp4

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

解析失败会写入 `<omni-media-analysis-error>`，不会阻断整个回合；文件过大则写入 `<omni-media-note>`，提示模型按需调用 `omni_media`。

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
- API Key 只保存在当前 profile 配置或环境变量中；日志和错误信息会脱敏。

## 验证记录

在 Windows + DSH 0.2.1-rc.2 环境下已验证：

- 所配置的接入点 `GET /models` 可列出 `qwen3.8-omni-flash`；API Key 有效。
- 8 秒中文 TTS WAV：逐字转写与语气判断正确。
- 4 秒 MP4（蓝色背景 + 两行中文）：画面描述与 OCR 正确。
- 非流式请求 `stream: false` 可用，响应为 `choices[0].message.content` 字符串。
- 大文件：1000 秒 MP3 自动切成 2 段，每段 Base64 均小于 10MB。
- `Config` schema 可导出，`normalizeConfig` 能读取 Schemastery `volatile` 字段与页面 Key；`Config.listConfigs` 状态为 `schema`，`apiKey` 带 `role: secret`。
- profile 依赖已指向 `~/.dsh/plugins/qwen-omni-bridge` 运行时副本；移动/改名工作区不影响插件加载。
- 通过子代理真实调用 `omni_media` 可返回视频文字；重新安装到运行时副本后再次调用成功返回音频气温（页面 Key 留空，走环境变量回退）。
- `mediaPolicy: omni-only` 已写入插件 system prompt、Config schema/`cordis.patch.yml`、Client 配置页 banner 和 `~/.dsh/AGENTS.md`；配置为其他值会拒绝激活。

未完成/受限验证：

- 自动路由的完整 Web UI 上传链路需要真实上传附件；已用单元方式验证 pre-step 消息注入逻辑（真实 API + 假 ctx），端到端上传未在无浏览器控制的情况下验证。
- 超长视频（> 48 分钟，12 段上限）的质量与耗时。
- 客户端配置页已实现并通过本地 `client smoke` 测试（注册键 `@local/qwen-omni-bridge#qwen-omni-bridge`）；当前打开的页面需要刷新一次才会加载新的 Client 模块，尚未在浏览器中目视确认表单渲染。
- 策略说明：此前“视频最后曲线”一问使用了 `ffmpeg` 抽帧 + `read_image`（旧做法）；现在 `mediaPolicy: omni-only` 已明确禁止该路径，后续视频内容（含画面、公式、曲线）应通过 `omni_media` 分析。

## 文件结构

```text
qwen-omni-bridge/
├─ index.js                 # Host Loader 入口
├─ client.js                # Client 端配置页（注册 plugins.row.config）
├─ lib/
│  ├─ plugin.js             # 工具注册、pre-step 自动路由、系统提示
│  ├─ config.js             # Config schema、配置归一化
│  ├─ key.js                # 页面 Key / 环境变量 / HKCU 解析
│  ├─ api.js                # OpenAI 兼容 Chat Completions 客户端
│  ├─ analyze.js            # 路径解析、提示词、结果截断
│  └─ media.js              # 类型识别、Base64、ffmpeg 转码与分段
├─ cordis.patch.yml         # bundle patch
├─ locale/{zh,en}.json      # 插件管理器显示元数据
├─ icon.svg
├─ scripts/sync-to-dsh.ps1  # 同步到 DSH 运行时副本
└─ test/smoke.mjs           # 本地冒烟测试
```

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
