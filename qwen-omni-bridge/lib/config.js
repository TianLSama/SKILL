/** 插件配置归一化与插件管理页面使用的 Config schema。 */
import os from 'node:os';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';

export const DEFAULT_BASE_URL = 'https://ws-srp61mkj9bp9w0ct.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen3.8-omni-flash';
export const DEFAULT_API_KEY_ENV = ['ALIYUN_API_KEY', 'DASHSCOPE_API_KEY'];
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'xhigh'];

/**
 * 插件管理页面的配置表单。字段使用 `.volatile()`，这样设置页修改后
 * `config.<field>.get()` 能在下一次工具调用 / pre-step 时读到新值，无需重启。
 */
export const Config = z
  .object({
    baseURL: z
      .string()
      .default(DEFAULT_BASE_URL)
      .description('OpenAI 兼容接入点，通常以 /compatible-mode/v1 结尾。')
      .volatile(),
    apiKey: z
      .string()
      .role('secret')
      .default('')
      .description('API Key。留空时读取环境变量 ALIYUN_API_KEY（其次 DASHSCOPE_API_KEY）。')
      .volatile(),
    apiKeyEnv: z
      .string()
      .default('ALIYUN_API_KEY')
      .description('页面 API Key 留空时优先读取的环境变量名；仍会回退到 ALIYUN_API_KEY / DASHSCOPE_API_KEY。')
      .volatile(),
    model: z
      .string()
      .default(DEFAULT_MODEL)
      .description('模型名称，默认 qwen3.8-omni-flash。')
      .volatile(),
    reasoningEffort: z
      .union(REASONING_EFFORTS)
      .default('low')
      .description('思考强度：none 最快，low 默认，medium/xhigh 更深入但更慢。')
      .volatile(),
    autoAnalyzeAttachments: z
      .boolean()
      .default(true)
      .description('用户上传音视频附件时自动调用全模态模型解析。')
      .volatile(),
    allowOutsideWorkspace: z
      .boolean()
      .default(false)
      .description('允许 omni_media 读取工作区和 DSH 附件目录之外的路径。')
      .volatile(),
    autoAnalyzeMaxBytes: z
      .number()
      .step(1)
      .min(1)
      .default(8_000_000)
      .description('自动解析的媒体大小上限（字节）；超过后提示模型按需调用工具。')
      .volatile(),
    autoAnalyzeTimeoutMs: z
      .number()
      .step(1)
      .min(5_000)
      .default(120_000)
      .description('自动解析超时（毫秒）。')
      .volatile(),
    autoMaxOutputChars: z
      .number()
      .step(1)
      .min(500)
      .default(12_000)
      .description('自动解析结果写入上下文的最大字符数。')
      .volatile(),
    maxOutputChars: z
      .number()
      .step(1)
      .min(500)
      .default(40_000)
      .description('omni_media 工具结果的最大字符数。')
      .volatile(),
    timeoutMs: z
      .number()
      .step(1)
      .min(10_000)
      .default(600_000)
      .description('omni_media 单次调用超时（毫秒）。修改后需重载插件生效。')
      .volatile(),
    maxSegments: z
      .number()
      .step(1)
      .min(1)
      .default(12)
      .description('单个媒体最多切分的段数，防止超长媒体产生过多请求。')
      .volatile(),
    ffmpegPath: z
      .string()
      .default('ffmpeg')
      .description('ffmpeg 可执行文件路径；默认从 PATH 查找。')
      .volatile(),
    ffprobePath: z
      .string()
      .default('ffprobe')
      .description('ffprobe 可执行文件路径；默认从 PATH 查找。')
      .volatile(),
    debug: z
      .boolean()
      .default(false)
      .description('输出调试日志（不包含 API Key）。')
      .volatile(),
  })
  .description('Qwen 全模态桥接配置');

function positiveInt(value, fallback, min = 1) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min ? n : fallback;
}

function textOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

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

/** 默认的 DSH 数据目录；attachment-local 默认把附件放在其 attachments 子目录。 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * 把 Loader 传入的原始配置转成稳定的运行时配置。
 * 同时兼容普通对象和 Schemastery 的 volatile 字段（`.get()`）。
 * @param {unknown} raw
 */
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const reasoningValue = field(cfg, 'reasoningEffort');
  const reasoningEffort = REASONING_EFFORTS.includes(reasoningValue) ? reasoningValue : 'low';
  const baseURLValue = field(cfg, 'baseURL');
  const modelValue = field(cfg, 'model');
  const apiKeyValue = field(cfg, 'apiKey');
  const apiKeyEnvValue = field(cfg, 'apiKeyEnv');
  const ffmpegValue = field(cfg, 'ffmpegPath');
  const ffprobeValue = field(cfg, 'ffprobePath');
  const dshHomeValue = field(cfg, 'dshHome');
  const dshHome = dshHomeValue ? path.resolve(String(dshHomeValue)) : resolveDshHome();
  const primaryEnv =
    typeof apiKeyEnvValue === 'string' && apiKeyEnvValue.trim()
      ? apiKeyEnvValue.trim()
      : 'ALIYUN_API_KEY';

  return {
    baseURL: textOr(baseURLValue, DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: textOr(modelValue, DEFAULT_MODEL),
    apiKey: typeof apiKeyValue === 'string' ? apiKeyValue.trim() : '',
    apiKeyEnv: [...new Set([primaryEnv, ...DEFAULT_API_KEY_ENV])],
    reasoningEffort,
    autoAnalyzeAttachments: field(cfg, 'autoAnalyzeAttachments') !== false,
    autoAnalyzeMaxBytes: positiveInt(field(cfg, 'autoAnalyzeMaxBytes'), 8_000_000),
    autoAnalyzeTimeoutMs: positiveInt(field(cfg, 'autoAnalyzeTimeoutMs'), 120_000, 5_000),
    autoMaxOutputChars: positiveInt(field(cfg, 'autoMaxOutputChars'), 12_000, 500),
    maxOutputChars: positiveInt(field(cfg, 'maxOutputChars'), 40_000, 500),
    timeoutMs: positiveInt(field(cfg, 'timeoutMs'), 600_000, 10_000),
    allowOutsideWorkspace: field(cfg, 'allowOutsideWorkspace') === true,
    ffmpegPath: textOr(ffmpegValue, 'ffmpeg'),
    ffprobePath: textOr(ffprobeValue, 'ffprobe'),
    maxSegments: positiveInt(field(cfg, 'maxSegments'), 12, 1),
    debug: field(cfg, 'debug') === true,
    dshHome,
    attachmentsRoot: path.join(dshHome, 'attachments'),
  };
}
