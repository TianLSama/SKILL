/** 插件配置：插件管理页面可编辑，全部 `.volatile()`，运行时用 `.get()` 读取。 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_SEARCH_SITES } from './identify.js';

export const DEFAULT_COMMAND = 'song-id';

export const Config = z
  .object({
    maxSeconds: z
      .number()
      .step(1)
      .min(5)
      .max(600)
      .default(90)
      .description('单次内录的最长秒数；到时自动停止录音。')
      .volatile(),
    reasoningEffort: z
      .union(['none', 'low', 'medium', 'xhigh'])
      .default('xhigh')
      .description('omni 模型的思考强度；xhigh 更细但更慢。')
      .volatile(),
    ffmpegPath: z
      .string()
      .default('ffmpeg')
      .description('ffprobe/ffmpeg 可执行文件路径；默认从 PATH 查找，用于读取录音时长。')
      .volatile(),
    pwshPath: z
      .string()
      .default('pwsh')
      .description('运行内录脚本的 PowerShell 可执行文件路径。')
      .volatile(),
    keepRecording: z
      .boolean()
      .default(false)
      .description('识别完成后保留临时录音 WAV，便于排查问题。')
      .volatile(),
    promptExtra: z
      .string()
      .default('')
      .description('追加到识别提示词末尾的额外要求（例如只关注曲风）。')
      .volatile(),
    autoLyricsFollowup: z
      .boolean()
      .default(true)
      .description('识别出歌词后，自动把歌词片段发给主模型，让它用网络搜索到网易云、酷狗、QQ 音乐、汽水音乐、萌娘百科等站点核对歌曲。')
      .volatile(),
    searchSites: z
      .string()
      .default(DEFAULT_SEARCH_SITES)
      .description('主模型核对歌词时优先参考的音乐站点清单。')
      .volatile(),
    debug: z
      .boolean()
      .default(false)
      .description('输出调试日志（不包含 API Key）。')
      .volatile(),
  })
  .description('听歌识曲：WASAPI 内录 + qwen3.8-omni-flash 音乐特征分析');

/** 读取普通对象字段，或 Schemastery volatile 字段的 `.get()`。 */
function field(raw, name) {
  const value = raw?.[name];
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get();
    } catch {
      return undefined;
    }
  }
  return value;
}

function positiveInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}

function textOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** 把 Loader 传入的原始配置归一化成稳定运行时配置。 */
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const effort = field(cfg, 'reasoningEffort');
  return {
    maxSeconds: positiveInt(field(cfg, 'maxSeconds'), 90, 5, 600),
    reasoningEffort: ['none', 'low', 'medium', 'xhigh'].includes(effort) ? effort : 'xhigh',
    ffmpegPath: textOr(field(cfg, 'ffmpegPath'), 'ffmpeg'),
    pwshPath: textOr(field(cfg, 'pwshPath'), 'pwsh'),
    keepRecording: field(cfg, 'keepRecording') === true,
    promptExtra: typeof field(cfg, 'promptExtra') === 'string' ? field(cfg, 'promptExtra').trim() : '',
    autoLyricsFollowup: field(cfg, 'autoLyricsFollowup') !== false,
    searchSites: textOr(field(cfg, 'searchSites'), DEFAULT_SEARCH_SITES),
    debug: field(cfg, 'debug') === true,
  };
}
