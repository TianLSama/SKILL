/** 插件配置归一化：所有可调参数集中在这里，避免散落在业务代码中。 */
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://ws-srp61mkj9bp9w0ct.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_MODEL = 'qwen3.8-omni-flash';
export const DEFAULT_API_KEY_ENV = ['ALIYUN_API_KEY', 'DASHSCOPE_API_KEY'];
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'xhigh'];

function positiveInt(value, fallback, min = 1) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min ? n : fallback;
}

function envNames(value) {
  if (Array.isArray(value)) {
    const list = value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return list.length > 0 ? [...new Set(list)] : [...DEFAULT_API_KEY_ENV];
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [...DEFAULT_API_KEY_ENV];
}

/** 默认的 DSH 数据目录；attachment-local 默认把附件放在其 attachments 子目录。 */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * 把 Loader 传入的原始配置转成稳定的运行时配置。
 * 这里刻意不依赖 schemastery：插件包可以零依赖安装，配置在 apply 时校验。
 * @param {unknown} raw
 */
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const reasoningEffort = REASONING_EFFORTS.includes(cfg.reasoningEffort)
    ? cfg.reasoningEffort
    : 'low';
  const dshHome = cfg.dshHome ? path.resolve(String(cfg.dshHome)) : resolveDshHome();
  return {
    baseURL: typeof cfg.baseURL === 'string' && cfg.baseURL.trim()
      ? cfg.baseURL.trim().replace(/\/+$/, '')
      : DEFAULT_BASE_URL,
    model: typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim() : DEFAULT_MODEL,
    apiKeyEnv: envNames(cfg.apiKeyEnv),
    reasoningEffort,
    autoAnalyzeAttachments: cfg.autoAnalyzeAttachments !== false,
    autoAnalyzeMaxBytes: positiveInt(cfg.autoAnalyzeMaxBytes, 8_000_000),
    autoAnalyzeTimeoutMs: positiveInt(cfg.autoAnalyzeTimeoutMs, 120_000, 5_000),
    autoMaxOutputChars: positiveInt(cfg.autoMaxOutputChars, 12_000, 500),
    maxOutputChars: positiveInt(cfg.maxOutputChars, 40_000, 500),
    timeoutMs: positiveInt(cfg.timeoutMs, 600_000, 10_000),
    allowOutsideWorkspace: cfg.allowOutsideWorkspace === true,
    ffmpegPath: typeof cfg.ffmpegPath === 'string' && cfg.ffmpegPath.trim() ? cfg.ffmpegPath.trim() : 'ffmpeg',
    ffprobePath: typeof cfg.ffprobePath === 'string' && cfg.ffprobePath.trim() ? cfg.ffprobePath.trim() : 'ffprobe',
    maxSegments: positiveInt(cfg.maxSegments, 12, 1),
    debug: cfg.debug === true,
    dshHome,
    attachmentsRoot: path.join(dshHome, 'attachments'),
  };
}
