/**
 * 听歌识曲 Host 插件：
 *   1. 注册 `/song-id` 命令，用 WASAPI loopback 内录电脑正在播放的声音；
 *   2. 结束录音后把 WAV 交给 qwen-omni-bridge 的 `omni_media` 工具，
 *      由 qwen3.8-omni-flash 做多维度音乐特征分析；
 *   3. 返回结构化文本结果，供 `/听歌识曲` 客户端小窗与会话展示。
 *
 * 客户端入口（/听歌识曲 命令与小窗）由 client.js 提供，它只是这里的调用方。
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Config, normalizeConfig } from './config.js';
import { buildAnalysisText, buildModelFollowup, identifyWithBridge, splitAnalysis } from './identify.js';
import {
  cancelRecording,
  cleanupSession,
  currentSession,
  sleep,
  startRecording,
  stopAndCollect,
} from './recorder.js';

export const name = 'song-recognizer';
export const inject = ['tools', 'commands', 'workingDirectory', 'systemPrompt'];
export { Config };

const COMMAND_NAME = 'song-id';
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RECORD_SCRIPT = path.join(PACKAGE_ROOT, 'scripts', 'loopback-record.ps1');

const SECTION_TEXT = `## 听歌识曲

用户可以在输入框发送 \`/${COMMAND_NAME}\` 命令（中文入口 \`/听歌识曲\` 会弹出录音小窗）来识别电脑正在播放的歌曲。
- 录音走 WASAPI loopback 内录系统默认播放设备的声音，不使用麦克风。
- 结束录音后由 qwen3.8-omni-flash 做多维度音乐特征分析（曲目、流派、BPM、调性、编曲、情绪等）。
- 识别完成后，插件会把整份结果作为一条 \`<听歌识曲-识别结果>\` 消息发给你，其中包含识别摘要、可辨认的歌词片段与分析正文：
  - 有歌词时，请用网络搜索按歌词匹配歌曲，重点参考网易云音乐、酷狗音乐、QQ 音乐、汽水音乐、萌娘百科以及其他音乐/歌词站点，核对歌名、演唱者、版本（原唱/翻唱/现场/Remix）、专辑与发行时间，并说明判定依据；检索不到就给出最接近的候选与置信度，不要编造；
  - 没有歌词时，不要猜测具体歌名，只说明曲目无法确定并整理音乐特征。
- 小窗只负责开始/结束录音，不在小窗展示分析结果；最终结论由你在会话里给出。
- 如果用户问"现在放的是什么歌"，提示他发送 \`/听歌识曲\` 或 \`/${COMMAND_NAME}\`，不要凭对话内容猜测歌曲。`;

function parseAction(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim().toLowerCase() : '';
  if (!text) return 'start';
  if (text === 'start' || text === 'begin' || text === '开始') return 'start';
  if (text === 'stop' || text === 'end' || text === '结束') return 'stop';
  if (text === 'cancel' || text === '取消') return 'cancel';
  if (text === 'status' || text === '状态') return 'status';
  return undefined;
}

async function resolveCwd(ctx, agent, signal) {
  try {
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    if (cwd) return cwd;
  } catch {
    // 回退到默认目录。
  }
  return ctx.workingDirectory.defaultDirectory || process.cwd();
}

async function describeStatus() {
  const session = currentSession();
  if (!session || session.exited) return '当前没有正在进行的录音。';
  const elapsed = ((Date.now() - session.startedAt) / 1000).toFixed(1);
  return `正在录制电脑声音：已录 ${elapsed} 秒。发送 \`/${COMMAND_NAME} stop\` 结束录音并识别。`;
}

/** 构造发给主模型的识别结果消息（作为一条独立的 user 回合）。 */
function createFollowupMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'song-recognizer',
      form: 'notice',
      summary: '听歌识曲：把识别结果交给主模型核对',
    },
  };
}

/**
 * 把整份识别结果交给主模型：有歌词就联网核对，没有歌词就整理音乐特征。
 * @returns {{ sent: boolean, note: string }}
 */
function sendModelFollowup({ agent, structured, analysisBody, cfg, durationSeconds }) {
  if (!cfg.autoModelFollowup) {
    return { sent: false, note: '已关闭「结果交给主模型」开关。' };
  }
  const text = buildModelFollowup({
    structured,
    analysisBody,
    durationSeconds,
    searchSites: cfg.searchSites,
  });
  if (!text) {
    return { sent: false, note: '本次没有识别出可传达的内容。' };
  }
  if (!agent || typeof agent.followup !== 'function') {
    return { sent: false, note: '当前会话无法唤醒主模型。' };
  }
  try {
    agent.followup(createFollowupMessage(text));
    return { sent: true, note: '' };
  } catch (error) {
    return { sent: false, note: `发送给主模型失败：${error?.message ?? String(error)}` };
  }
}

/** 注册命令与系统提示。 */
export function apply(ctx, rawConfig) {
  const initial = normalizeConfig(rawConfig);
  const currentConfig = () => normalizeConfig(rawConfig);
  const debug = (...args) => {
    if (currentConfig().debug) console.log('[song-recognizer]', ...args);
  };

  const start = async (agent, signal) => {
    const cfg = currentConfig();
    const cwd = await resolveCwd(ctx, agent, signal);
    const session = await startRecording({
      cwd,
      scriptPath: RECORD_SCRIPT,
      maxSeconds: cfg.maxSeconds,
      pwshPath: cfg.pwshPath,
      debug: cfg.debug,
    });
    const lines = [
      `已开始录制电脑声音（WASAPI 内录，不使用麦克风），最长 ${cfg.maxSeconds} 秒。`,
      `- 录音目录：${session.dir}`,
      `- 结束并识别：发送 \`/${COMMAND_NAME} stop\`，或使用 \`/听歌识曲\` 小窗点击「结束录音并识别」。`,
    ];
    return { kind: 'success', text: lines.join('\n') };
  };

  const stop = async (agent, signal) => {
    const cfg = currentConfig();
    const info = await stopAndCollect({ debug: cfg.debug });
    debug(`录音结束：${info.durationSeconds.toFixed(1)} 秒，${info.bytes} 字节`);
    try {
      if (info.durationSeconds < 0.5) {
        throw new Error('录音时长过短（不足 1 秒），没有足够内容用于识别。');
      }
      const result = await identifyWithBridge({
        wavPath: info.wavPath,
        tools: ctx.tools,
        agent,
        signal,
        effort: cfg.reasoningEffort,
        promptExtra: cfg.promptExtra,
        debug: cfg.debug,
      });
      const { structured, body } = splitAnalysis(result.answer);
      const followup = sendModelFollowup({
        agent,
        structured,
        analysisBody: body,
        cfg,
        durationSeconds: info.durationSeconds,
      });
      debug('识别结果交给主模型：', followup.sent);
      const seconds = info.durationSeconds.toFixed(1);
      if (followup.sent) {
        return {
          kind: 'success',
          text: `已结束录音（${seconds} 秒），识别结果已交给主模型，最终结论会由主模型在会话里给出。`,
        };
      }
      // 无法交给主模型时退回完整分析，避免结果丢失。
      const text = buildAnalysisText({
        answer: result.answer,
        model: result.model,
        durationSeconds: info.durationSeconds,
        wavBytes: info.bytes,
      });
      return { kind: 'success', text: followup.note ? `${text}\n\n（${followup.note}）` : text };
    } finally {
      if (!cfg.keepRecording) await cleanupSession(info);
    }
  };

  const cancel = async () => {
    const result = await cancelRecording();
    return result.cancelled
      ? { kind: 'success', text: '已取消这次听歌识曲录音，临时文件已清理。' }
      : { kind: 'success', text: '当前没有正在进行的录音。' };
  };

  ctx.commands.register({
    name: COMMAND_NAME,
    description:
      '听歌识曲：start 开始 WASAPI 内录电脑声音，stop 结束录音并交由 qwen3.8-omni-flash 识别，cancel 放弃，status 查看状态。通常由 /听歌识曲 小窗调用。',
    input: { hint: 'start | stop | cancel | status' },
    handler: async (invocation) => {
      const { agent, rawInput, signal } = invocation;
      const action = parseAction(rawInput);
      if (!action) {
        return {
          kind: 'error',
          text: `未知参数：${rawInput}。可用参数：start、stop、cancel、status。`,
        };
      }
      debug(`命令参数：${action}`);
      if (action === 'start') return start(agent, signal);
      if (action === 'stop') {
        try {
          return await stop(agent, signal);
        } catch (error) {
          return { kind: 'error', text: `识别失败：${error?.message ?? String(error)}` };
        }
      }
      if (action === 'cancel') return cancel();
      return { kind: 'success', text: await describeStatus() };
    },
  });

  ctx.systemPrompt.section({
    name: 'song-recognizer',
    order: 1905,
    text: SECTION_TEXT,
  });

  debug('插件已加载', { command: COMMAND_NAME, script: RECORD_SCRIPT, maxSeconds: initial.maxSeconds });
}

/** 测试用导出。 */
export const __test = {
  parseAction,
  SECTION_TEXT,
  COMMAND_NAME,
  RECORD_SCRIPT,
  sleep,
};
