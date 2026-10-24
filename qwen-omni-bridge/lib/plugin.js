/**
 * Host 插件入口：
 *   1. 注册 omni_media 工具，让主模型按需调用 qwen3.8-omni-flash；
 *   2. 在 agent/pre-step 中自动把用户刚上传的音视频送去做一次解析，
 *      把结果作为 <omni-media-analysis> 文本块并入用户消息，主模型下一步即可直接理解；
 *   3. 注入一小段系统提示，说明音视频文件句柄与工具的用法。
 */
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { analyzeMedia, autoPrompt, NO_API_KEY_MESSAGE } from './analyze.js';
import { Config, normalizeConfig } from './config.js';
import { resolveApiKey } from './key.js';
import {
  classifyByName,
  detectMediaKind,
  formatBytes,
  mediaKindLabel,
} from './media.js';

export const name = 'qwen-omni-bridge';
export const inject = ['tools', 'systemPrompt', 'attachments', 'workingDirectory'];
export { Config };

const TOOL_NAME = 'omni_media';

const SECTION_TEXT = `## 音视频理解策略（omni-only）

音视频理解**全部**交给外部模型 qwen3.8-omni-flash；你只负责调度与整合。

- 你的职责：理解用户意图、拆分问题、决定让 omni 看/听哪一段、整合结果并回答。
- 所有音频、视频内容（包括画面、人物动作、屏幕文字、公式、图表、曲线、镜头变化）都必须通过 \`${TOOL_NAME}\` 获取。禁止用 ffmpeg 抽帧、截图、\`read_image\` 或其他主模型视觉方式替代视频理解。
- 用户直接提供的静态图片仍可直接读取；但从视频中取出的帧/截图属于视频理解，必须交给 \`${TOOL_NAME}\`。
- 用户上传的音视频通常已自动解析，结果以 \`<omni-media-analysis>\` 出现在用户消息之后；可直接使用，也可用 \`${TOOL_NAME}\` 追问。
- 如果结果不够，继续用 \`${TOOL_NAME}\` 追问（可指定时间段、画面或具体问题）；不要自行抽帧兜底。自动解析失败或文件过大时，按提示调用 \`${TOOL_NAME}\`。
- 工具支持本地路径、工作区相对路径和 http(s) URL；大于约 7MB 会自动压缩/分段。`;

const TOOL_DESCRIPTION = `使用 Qwen3.8-Omni-Flash 理解音频、视频或图片。音视频理解策略为 omni-only：主模型只负责调度与整合，所有音频、视频内容（包括画面、人物动作、屏幕文字、公式、图表、曲线）都必须通过本工具分析，禁止用 ffmpeg 抽帧 + read_image/截图 OCR 替代。传入本地路径（绝对路径或当前工作目录相对路径）或 http(s) URL，以及你的问题；返回模型对该媒体的文字分析。单文件超过约 7MB 时会自动压缩/分段，长视频可能耗时较久。一次可分析多个媒体。`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    model: { type: 'string' },
    media: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          kind: { type: 'string' },
          bytes: { type: 'integer' },
          segments: { type: 'integer' },
        },
        required: ['path', 'kind', 'bytes', 'segments'],
      },
    },
    note: { type: 'string' },
  },
  required: ['answer', 'model', 'media'],
};

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function analysisBlock(kind, name, attachmentId, model, text) {
  return `<omni-media-analysis file="${escapeXml(name)}" attachment="${escapeXml(attachmentId)}" kind="${kind}" model="${escapeXml(model)}">\n${text}\n</omni-media-analysis>`;
}

function noteBlock(kind, name, attachmentId, body) {
  return `<omni-media-note file="${escapeXml(name)}" attachment="${escapeXml(attachmentId)}" kind="${kind}">${body}</omni-media-note>`;
}

function errorBlock(kind, name, attachmentId, message) {
  return `<omni-media-analysis-error file="${escapeXml(name)}" attachment="${escapeXml(attachmentId)}" kind="${kind}">自动解析失败：${escapeXml(message)}。可调用 ${TOOL_NAME} 重试。</omni-media-analysis-error>`;
}

function hasMarker(message, attachmentId) {
  const needle = `attachment="${escapeXml(attachmentId)}"`;
  return message.content.some(
    (block) => block?.type === 'text' && typeof block.text === 'string' && block.text.includes(needle),
  );
}

/**
 * 自动解析结果作为一条独立的 user 消息插入，而不是改写原消息。
 * 这与 dsh-time-context / dsh-agent-instructions 的 pre-step 做法一致：
 * 原消息保持不可变，新消息带自己的 id 和 source.kind，可安全持久化。
 */
function createAnalysisMessage(text, fileCount) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'qwen-omni-bridge',
      form: 'notice',
      summary: `已自动解析 ${fileCount} 个音视频附件`,
    },
  };
}

function validateToolArgs(args) {
  const value = args && typeof args === 'object' ? args : {};
  const rawPaths = Array.isArray(value.paths) ? value.paths : value.paths !== undefined ? [value.paths] : [];
  if (rawPaths.length === 0) throw new Error('paths 不能为空：请传入至少一个音频、视频或图片路径。');
  if (rawPaths.length > 8) throw new Error('一次最多分析 8 个媒体文件。');
  const paths = rawPaths.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error('paths 中的每一项都必须是非空字符串。');
    return item.trim();
  });
  const prompt = typeof value.prompt === 'string' && value.prompt.trim() ? value.prompt.trim() : undefined;
  const effort = value.reasoning_effort;
  if (effort !== undefined && !['none', 'low', 'medium', 'xhigh'].includes(effort)) {
    throw new Error('reasoning_effort 只能是 none、low、medium、xhigh。');
  }
  return { paths, prompt, effort };
}

/** 注册工具 + 自动路由 + 系统提示。 */
export function apply(ctx, rawConfig) {
  const assertMediaPolicy = (cfg) => {
    if (cfg.mediaPolicy !== 'omni-only') {
      throw new Error(
        'mediaPolicy 固定为 omni-only：音视频理解全部交给 qwen3.8-omni-flash，主模型只负责调度与整合。',
      );
    }
  };
  const initial = normalizeConfig(rawConfig);
  assertMediaPolicy(initial);
  const currentConfig = () => {
    const cfg = normalizeConfig(rawConfig);
    assertMediaPolicy(cfg);
    return cfg;
  };
  const processed = new Set();
  const debug = (...args) => {
    if (currentConfig().debug) console.log('[qwen-omni-bridge]', ...args);
  };

  ctx.tools.register({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            '媒体文件路径或 URL 数组。支持音频 wav/mp3/aac/amr/3gp，视频 mp4/avi/mkv/mov/flv/wmv，图片 png/jpg/webp/gif。相对路径以当前工作目录为准。',
        },
        prompt: {
          type: 'string',
          description:
            '希望模型回答的问题。省略时默认要求：内容概述、语音转写、声音事件、画面与屏幕文字。',
        },
        reasoning_effort: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'xhigh'],
          description: '思考强度：none 最快，low 默认，medium/xhigh 更深入但更慢。',
        },
      },
      required: ['paths'],
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        const names = value.media
          .map((item) => `${mediaKindLabel(item.kind)} ${item.path}${item.segments > 1 ? `（${item.segments} 段）` : ''}`)
          .join('、');
        const note = value.note ? `\n\n${value.note}` : '';
        return [{ type: 'text', text: `[${value.model}] ${names}\n\n${value.answer}${note}` }];
      },
    },
    timeoutMs: initial.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { paths, prompt, effort } = validateToolArgs(args);
      const cfg = currentConfig();
      let cwd;
      if (exec.agent) {
        cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal).catch(() => undefined);
      }
      if (!cwd) cwd = ctx.workingDirectory.defaultDirectory || process.cwd();

      const result = await analyzeMedia({
        inputs: paths.map((item) => ({ path: item })),
        prompt,
        cfg: { ...cfg, reasoningEffort: effort ?? cfg.reasoningEffort },
        cwd,
        signal: exec.signal,
        timeoutMs: cfg.timeoutMs,
      });

      const segments = result.media.reduce((sum, item) => sum + item.segments, 0);
      const note =
        segments > result.media.length
          ? `为适配接口的 10MB Base64 上限，较大的媒体已由 ffmpeg 自动压缩或分段（共 ${segments} 段）。`
          : undefined;
      return {
        answer: result.text,
        model: result.model,
        media: result.media.map((item) => ({
          path: item.path,
          kind: item.kind,
          bytes: item.bytes,
          segments: item.segments,
        })),
        ...(note ? { note } : {}),
      };
    },
  });

  ctx.systemPrompt.section({
    name: 'qwen-omni-bridge',
    order: 1900,
    text: SECTION_TEXT,
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    const cfg = currentConfig();
    if (!cfg.autoAnalyzeAttachments || decision.kind !== 'enter') return decision;
    const { signal } = payload;
    if (!Array.isArray(decision.messages) || decision.messages.length === 0) return decision;

    /** @type {Array<{ message: any, files: Array<{ ref: any, kind: string, key: string, hostPath: string, name: string }> }>} */
    const targets = [];
    for (const message of decision.messages) {
      if (!message || message.role !== 'user' || !Array.isArray(message.content)) continue;
      const files = [];
      for (const block of message.content) {
        if (block?.type !== 'file' || !block.attachment) continue;
        const ref = block.attachment;
        const attachmentId = typeof ref.attachmentId === 'string' ? ref.attachmentId : undefined;
        if (!attachmentId) continue;
        const key = `${message.id}:${attachmentId}`;
        if (processed.has(key) || hasMarker(message, attachmentId)) {
          processed.add(key);
          continue;
        }
        let hostPath;
        try {
          hostPath = ctx.attachments.fileHostPath(ref);
        } catch {
          hostPath = undefined;
        }
        if (!hostPath) continue;
        const kind = classifyByName(ref.name) || (await detectMediaKind(hostPath, ref.name));
        if (kind !== 'audio' && kind !== 'video') continue;
        files.push({
          ref,
          kind,
          key,
          hostPath,
          name: ref.name || path.basename(hostPath),
        });
      }
      if (files.length > 0) targets.push({ message, files });
    }
    if (targets.length === 0) return decision;

    const apiKey = resolveApiKey(cfg.apiKey, cfg.apiKeyEnv);
    const additions = new Map();
    for (const target of targets) {
      for (const file of target.files) processed.add(file.key);
      const texts = [];

      if (!apiKey) {
        texts.push(
          noteBlock(
            target.files[0].kind,
            target.files.map((file) => file.name).join('、'),
            target.files[0].ref.attachmentId,
            `未配置 API Key，无法自动解析音视频。${NO_API_KEY_MESSAGE} 也可以在配置中指定 apiKeyEnv。`,
          ),
        );
        additions.set(target.message.id, createAnalysisMessage(texts.join('\n\n'), target.files.length));
        continue;
      }

      for (const file of target.files) {
        if (signal?.aborted) throw signal.reason ?? new Error('已取消');
        try {
          const stat = await fsp.stat(file.hostPath);
          if (stat.size > cfg.autoAnalyzeMaxBytes) {
            texts.push(
              noteBlock(
                file.kind,
                file.name,
                file.ref.attachmentId,
                `检测到${mediaKindLabel(file.kind)}文件（${formatBytes(stat.size)}），超过自动解析上限 ` +
                  `${formatBytes(cfg.autoAnalyzeMaxBytes)}，未自动解析。需要理解内容时，请调用 ${TOOL_NAME} 工具并传入该路径：${file.hostPath}`,
              ),
            );
            continue;
          }
          debug(`自动解析 ${file.name}（${formatBytes(stat.size)}）`);
          const result = await analyzeMedia({
            inputs: [{ path: file.hostPath, name: file.name, kindHint: file.kind, allowOutside: true }],
            prompt: autoPrompt(file.kind),
            cfg: { ...cfg, maxOutputChars: cfg.autoMaxOutputChars },
            cwd: cfg.attachmentsRoot,
            signal,
            timeoutMs: cfg.autoAnalyzeTimeoutMs,
          });
          texts.push(
            analysisBlock(file.kind, file.name, file.ref.attachmentId, result.model, result.text),
          );
        } catch (error) {
          if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
          debug(`自动解析失败 ${file.name}：${error?.message}`);
          texts.push(errorBlock(file.kind, file.name, file.ref.attachmentId, error?.message ?? String(error)));
        }
      }
      if (texts.length > 0) {
        additions.set(target.message.id, createAnalysisMessage(texts.join('\n\n'), target.files.length));
      }
    }

    if (additions.size === 0) return decision;
    return {
      ...decision,
      messages: decision.messages.flatMap((message) => {
        const extra = additions.get(message.id);
        return extra ? [message, extra] : [message];
      }),
    };
  });

  debug('插件已加载', {
    model: initial.model,
    baseURL: initial.baseURL,
    mediaPolicy: initial.mediaPolicy,
    autoAnalyze: initial.autoAnalyzeAttachments,
    attachmentsRoot: initial.attachmentsRoot,
  });
}

/** 测试用导出，不影响 Loader。 */
export const __test = {
  validateToolArgs,
  analysisBlock,
  noteBlock,
  errorBlock,
  createAnalysisMessage,
  hasMarker,
  SECTION_TEXT,
  TOOL_DESCRIPTION,
};
