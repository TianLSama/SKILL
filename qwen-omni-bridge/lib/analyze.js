/** 一次全模态分析的编排：解析路径 → 生成 content parts → 调 API → 截断输出。 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { chatCompletion, OmniApiError } from './api.js';
import { resolveApiKey } from './key.js';
import {
  assertAllowedPath,
  makeTempDir,
  mediaKindLabel,
  prepareInput,
  removeTempDir,
} from './media.js';

export const NO_API_KEY_MESSAGE =
  '未找到 API Key：请设置环境变量 ALIYUN_API_KEY（或 DASHSCOPE_API_KEY）。' +
  '插件也会尝试读取 Windows 用户环境变量（HKCU\\Environment）。';

const VIDEO_PROMPT = `请完整解析这个视频，用中文输出：
1. 内容概述；
2. 按时间顺序描述画面、人物、动作、场景变化；
3. 画面中出现的文字/字幕（尽量逐字）；
4. 语音转写（逐字，尽量标注说话人）；
5. 音乐、环境声、音效；
6. 值得注意的细节。
只依据视频中实际存在的信息，不要编造；控制在 2000 字以内。`;

const AUDIO_PROMPT = `请完整解析这段音频，用中文输出：
1. 内容概述；
2. 语音逐字转写（尽量标注说话人和时间戳）；
3. 音乐、环境声、音效与说话语气；
4. 值得注意的细节。
只依据音频中实际存在的信息，不要编造；控制在 2000 字以内。`;

const IMAGE_PROMPT = `请用中文完整描述这张图片：
1. 画面主体与场景；
2. 图中文字（尽量逐字）；
3. 值得注意的细节。
只依据图片中实际存在的信息，不要编造。`;

export function buildPrompt(userPrompt, media) {
  const prompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (prompt) {
    return `请只依据提供的媒体内容，用中文回答下面的问题；媒体中没有的信息不要编造。\n\n${prompt}`;
  }
  const kinds = new Set(media.map((item) => item.kind));
  if (kinds.has('video')) {
    return media.length > 1
      ? `以下有 ${media.length} 个媒体文件。${VIDEO_PROMPT}\n如果包含多个文件，请分别说明每个文件的内容。`
      : VIDEO_PROMPT;
  }
  if (kinds.has('audio')) {
    return media.length > 1
      ? `以下有 ${media.length} 个音频文件。${AUDIO_PROMPT}\n请分别说明每个文件的内容。`
      : AUDIO_PROMPT;
  }
  return media.length > 1
    ? `以下有 ${media.length} 张图片。${IMAGE_PROMPT}\n请分别说明每张图片。`
    : IMAGE_PROMPT;
}

export function capText(text, maxChars) {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n…（输出过长，已截断；如需完整内容可缩小分析范围或拆分为多个文件）`;
}

/**
 * 解析一个工具/自动路由传入的媒体路径。
 * @param {{ path: string, name?: string, kindHint?: string, allowOutside?: boolean }} input
 * @param {{ cwd: string, cfg: object }} options
 */
export async function resolveMediaInput(input, { cwd, cfg }) {
  const raw = String(input.path ?? '').trim();
  if (!raw) throw new Error('媒体路径为空。');
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`无效的 URL：${raw}`);
    }
    return {
      url: parsed.toString(),
      name: input.name || path.basename(parsed.pathname) || 'remote-media',
      kindHint: input.kindHint,
    };
  }
  const absolute = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);
  let real;
  try {
    real = await fsp.realpath(absolute);
  } catch {
    throw new Error(`找不到文件：${raw}`);
  }
  assertAllowedPath(real, {
    cwd: await fsp.realpath(cwd).catch(() => cwd),
    attachmentsRoot: cfg.attachmentsRoot,
    allowOutside: input.allowOutside === true || cfg.allowOutsideWorkspace === true,
  });
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw new Error(`不是普通文件：${raw}`);
  return { path: real, name: input.name || path.basename(real), kindHint: input.kindHint };
}

/**
 * 分析一组媒体并返回文本结果。
 *
 * @param {object} options
 * @param {Array<{path?: string, url?: string, name?: string, kindHint?: string, allowOutside?: boolean}>} options.inputs
 * @param {string} [options.prompt]
 * @param {object} options.cfg normalizeConfig 的结果
 * @param {string} options.cwd
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ text: string, media: Array<{path:string,kind:string,bytes:number,segments:number}>, model: string, usage?: unknown }>}
 */
export async function analyzeMedia({ inputs, prompt, cfg, cwd, signal, timeoutMs }) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('没有提供媒体输入。');
  const apiKey = resolveApiKey(cfg.apiKeyEnv);
  if (!apiKey) throw new Error(NO_API_KEY_MESSAGE);

  const resolved = [];
  for (const input of inputs) resolved.push(await resolveMediaInput(input, { cwd, cfg }));

  const tempDir = await makeTempDir();
  try {
    const parts = [];
    const media = [];
    for (const input of resolved) {
      const prepared = await prepareInput(input, { cfg, tempDir, signal });
      parts.push(...prepared.parts);
      media.push(prepared.meta);
    }
    parts.push({ type: 'text', text: buildPrompt(prompt, media) });

    if (cfg.debug) {
      const kinds = media.map((item) => `${item.kind}:${item.bytes}B:${item.segments}段`).join(', ');
      console.log(`[qwen-omni-bridge] 请求 ${cfg.model}，媒体=${kinds}，apiKey=${apiKey.source}`);
    }

    const response = await chatCompletion({
      baseURL: cfg.baseURL,
      apiKey: apiKey.value,
      model: cfg.model,
      content: parts,
      reasoningEffort: cfg.reasoningEffort,
      signal,
      timeoutMs: timeoutMs ?? cfg.timeoutMs,
      debug: cfg.debug,
    });
    return {
      text: capText(response.text, cfg.maxOutputChars),
      media,
      model: response.model,
      usage: response.usage,
    };
  } catch (error) {
    if (error instanceof OmniApiError) throw error;
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('已取消');
    throw error;
  } finally {
    await removeTempDir(tempDir);
  }
}

/** 供自动路由使用的简短提示词。 */
export function autoPrompt(kind) {
  return kind === 'video' ? VIDEO_PROMPT : AUDIO_PROMPT;
}

/** 媒体在自动路由消息里的可读标签。 */
export function autoMediaLabel(kind, name) {
  return `${mediaKindLabel(kind)}「${name}」`;
}
