# 听歌识曲（song-recognizer）

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

把电脑正在播放的声音录下来，交给全模态模型识别歌曲并做多维度音乐特征分析。

- **内录，不用麦克风**：通过 Windows WASAPI 的 loopback 模式录制系统默认播放设备正在输出的声音，耳机/音箱里放什么就录什么。
- **复用已有桥接插件**：音频片段经 `qwen-omni-bridge` 注册的 `omni_media` 工具交给 `qwen3.8-omni-flash`，接入点、API Key、模型与推理强度都沿用桥接插件的配置，本插件不保存任何密钥。
- **多维度分析**：曲目、演唱者、版本、语言、流派、情绪、BPM、拍号、调性、编曲与乐器、人声特征、年代/制作风格、歌词片段、相似作品、置信度，另附分小节的中文分析。
- **命令 + 小窗**：输入 `/听歌识曲` 发送后弹出录音小窗，点「结束录音并识别」即可。

## 使用

### 小窗（推荐）

1. 在输入框输入 `/听歌识曲` 并回车。
2. 小窗自动开始内录，同时开始计时；让音乐继续播放，建议录 10–20 秒。
3. 点「结束录音并识别」，等待 10–40 秒，结果卡片会列出多维度音乐特征；「复制结果」把文字复制到剪贴板。

小窗里的按钮：

| 按钮 | 行为 |
| --- | --- |
| 结束录音并识别 | 停止内录，把录音交给 qwen3.8-omni-flash 分析 |
| 取消并丢弃 | 停止内录并删除临时录音 |
| 重新录音 | 关闭当前结果，重新开始一次录音 |

### 命令（可脚本化）

| 命令 | 说明 |
| --- | --- |
| `/song-id` 或 `/song-id start` | 开始一次内录（最长由配置 `maxSeconds` 决定，默认 90 秒） |
| `/song-id stop` | 结束录音并识别，结果作为命令结果返回 |
| `/song-id cancel` | 放弃本次录音并清理临时文件 |
| `/song-id status` | 查看当前录音状态与已录时长 |

`/听歌识曲` 是客户端命令，只在浏览器本地打开小窗；真正的录音与识别由 `/song-id` 在 Host 端执行。

## 前置条件

1. **Windows**：录音脚本使用 WASAPI loopback，仅支持 Windows。
2. **已安装并启用 `qwen-omni-bridge`**（`@local/qwen-omni-bridge`），并且它的接入点与 API Key 已配置可用；否则 `omni_media` 不可用，识别会报错。
3. **PowerShell 7（`pwsh`）**：录音脚本用它运行；可以在配置里用 `pwshPath` 指定完整路径。
4. 系统存在可用的默认播放设备（有声卡、有输出）。

## 工作原理

```text
/听歌识曲 ──▶ 客户端小窗（client.js）
                │  /song-id start
                ▼
        Host 命令（lib/plugin.js）
                │  spawn pwsh scripts/loopback-record.ps1
                ▼
        WASAPI loopback 录音 ──▶ WAV（IEEE float，系统混音格式）
                │  /song-id stop（写停止标志）
                ▼
        qwen-omni-bridge 的 omni_media 工具
                │  qwen3.8-omni-flash（多维度音乐特征提示词）
                ▼
        结果文本（JSON 块 + 分小节分析）──▶ 小窗卡片 / 命令结果
```

- 录音在 Host 进程外的一个 PowerShell 子进程中进行，插件只负责启动、等待就绪、写停止标志、收集结果。
- 临时录音放在会话工作目录下的 `.dsh-song-id/` 中；识别完成后默认删除（`keepRecording: true` 可保留）。
- 桥接插件里超过约 7MB 的音频会自动用 ffmpeg 转码/分段，本插件不需要额外处理。

## 配置

安装后打开 DSH 侧边栏的「插件」页，进入 **听歌识曲** 的包详情：组件行的标题会变成带 `›` 的按钮，点击即可打开配置页（由 Client 端注册 `plugins.row.config` 提供）。若刚安装完还看不到入口，刷新一次页面（建议 Ctrl+Shift+R）以加载 Client 模块。

也可以直接写在 profile 的 `cordis.patch.yml` 或本包 `cordis.patch.yml` 中，字段如下：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `maxSeconds` | `90` | 单次内录最长时间（秒），到时自动停止 |
| `reasoningEffort` | `xhigh` | 传给 omni 模型的思考强度：`none`/`low`/`medium`/`xhigh` |
| `pwshPath` | `pwsh` | 运行录音脚本的 PowerShell 路径 |
| `ffmpegPath` | `ffmpeg` | 读取录音信息用的 ffmpeg 路径（当前实现直接解析 WAV 头，保留该字段供后续使用） |
| `keepRecording` | `false` | 识别后是否保留临时 WAV |
| `promptExtra` | 空 | 追加到识别提示词末尾的额外要求 |
| `debug` | `false` | 输出调试日志（不含密钥） |

## 安装

插件是 Host + Client bundle，运行时使用 `~/.dsh/plugins/` 下的独立副本，避免工作区路径变化导致加载失败：

```powershell
# 1. 同步源码到 DSH 运行时副本并安装依赖
pwsh -File scripts\sync-to-dsh.ps1

# 2. 在 DSH 中安装指向运行时副本的 bundle
plugin_manager install_bundle target=%USERPROFILE%\.dsh\plugins\song-recognizer
```

安装后 bundle 会写入当前 profile 并在 Host 插件树中插入 `song-recognizer` 行。Client 端小窗与 `/听歌识曲` 命令需要刷新一次页面（建议 Ctrl+Shift+R）才会加载。

## 限制与注意事项

- 录音抓的是**系统默认播放设备**；如果音乐只从特定应用输出到其他设备，请先把该设备设为默认输出。
- 内录里静音（没有声音输出）的时间段不会被写入 WAV，所以实际时长可能略短于计时；只要有音乐在播放就能完整录到。
- 识别是概率性的：纯音乐、翻唱、现场版、混音、游戏/影视配乐可能只能得到风格特征而无法给出准确曲名，结果中的 `confidence` 仅供参考。
- 录音会上传到 qwen-omni-bridge 配置的云端接口，请勿在隐私场合使用内录。
- `/听歌识曲` 命令名是中文，只在客户端本地解析；Host 命令名固定为 ASCII 的 `song-id`。
- 分析耗时取决于网络与模型；`stop` 期间小窗会停留在「正在分析音乐特征…」。

## 验证记录

在 Windows 11 + PowerShell 7 环境下已验证：

- `scripts/loopback-record.ps1` 单独运行可录到系统回放（`pcm_f32le`、48kHz、双声道），音量正常（`mean_volume` 约 -14 dB）。
- 播放本地 FLAC 歌曲并内录 8.5 秒，`omni_media` 能正确判断语言（日语）、流派（高速电子/J-core 倾向）、情绪、BPM 区间、编曲与乐器、人声特征；8 秒片段不足以确认具体曲目，模型明确说明不确定而没有编造歌名。
- `test/host-flow.mjs`：用真实内录 + 替身 `omni_media` 验证 `/song-id` 的 start/status/stop/cancel 编排、参数校验、`录制时长 · 文件大小 · 模型` 结果格式与临时目录清理。
- `test/smoke.mjs`：配置归一化、参数解析、JSON/正文拆分、提示词维度、`client.js` 语法与命令名一致性、真实内录文件头解析全部通过。
- 安装 `install_bundle` 返回 `application: applied`，`Config.listConfigs` 中 `include:song-recognizer` 状态为 `schema`；Client `Slots.listSubTree` 的 `shell.overlay` 中已出现 `song-id.panel` occupant，`plugins.row.config` 中已出现 `@local/dsh-song-recognizer#song-recognizer` occupant，说明 Client 模块已加载并完成命令、浮层与配置页注册。
- 配置页通过 `plugins.row.config` 的 `form.state` / `form.mutate` 直接读写 Host Config，不依赖 `ui-primitives`。

未完成/受限验证：

- 浏览器小窗的目视效果（尺寸、深浅色、结果卡片排版）需要真实页面确认；Client 模块首次安装后需刷新页面。
- Client 端 `/听歌识曲` 命令点击到 `/song-id` RPC 的完整链路：调用方式与官方 `dsh-client-ui-commands` 相同（`ctx.remote.commands.execute(sessionId, line, attachments)`），但尚未在浏览器中实际点选验证。
- 长时间（>60 秒）录音与超长分析耗时的表现。
- 在系统没有任何播放设备（无默认输出端点）时的错误提示。

## 文件结构

```text
song-recognizer/
├─ index.js                  # Host Loader 入口
├─ client.js                 # Client 端：/听歌识曲 命令 + 录音小窗
├─ lib/
│  ├─ plugin.js              # 命令注册、start/stop/cancel/status 编排、系统提示
│  ├─ config.js              # Config schema 与配置归一化
│  ├─ recorder.js            # 录音子进程管理、WAV 头解析、临时目录清理
│  └─ identify.js            # 多维度音乐特征提示词、调用 omni_media、结果整理
├─ scripts/
│  ├─ loopback-record.ps1    # WASAPI loopback 录音脚本（内联 C# COM interop）
│  └─ sync-to-dsh.ps1        # 同步到 DSH 运行时副本并安装依赖
├─ cordis.patch.yml          # bundle patch
├─ locale/{zh,en}.json       # 插件管理器显示元数据
├─ icon.svg
└─ test/smoke.mjs            # 本地冒烟测试
```
