/**
 * qwen3.8-omni-flash 的 OpenAI 兼容 Chat Completions 客户端。
 * 不使用任何第三方 SDK：Node 内置 fetch 足够，也避免 profile 安装时的依赖解析问题。
 */

export class OmniApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OmniApiError';
    this.status = options.status;
    this.code = options.code;
  }
}

function redact(text, secret) {
  if (typeof text !== 'string') return '';
  if (typeof secret !== 'string' || secret.length < 8) return text;
  return text.split(secret).join('sk-***');
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

function retryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('已取消'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function combineSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * 发一次文本输出的全模态请求。
 *
 * @param {object} options
 * @param {string} options.baseURL
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {unknown[]} options.content Chat Completions 的 user.content 数组
 * @param {string} options.reasoningEffort none|low|medium|xhigh
 * @param {AbortSignal} [options.signal]
 * @param {number} options.timeoutMs
 * @param {boolean} [options.debug]
 * @returns {Promise<{ text: string, model: string, usage?: unknown, requestId?: string }>}
 */
export async function chatCompletion({
  baseURL,
  apiKey,
  model,
  content,
  reasoningEffort = 'low',
  signal,
  timeoutMs = 600_000,
  debug = false,
}) {
  const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content }],
    modalities: ['text'],
    stream: false,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const combined = combineSignal(signal, timeoutMs);
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (signal?.aborted) throw signal.reason ?? new Error('已取消');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
        signal: combined,
      });
      const text = await response.text();
      if (!response.ok) {
        const parsed = safeJson(text);
        const rawMessage =
          parsed?.error?.message ||
          parsed?.message ||
          (typeof text === 'string' && text.trim() ? text.trim().slice(0, 800) : `HTTP ${response.status}`);
        const error = new OmniApiError(
          `qwen3.8-omni-flash 接口返回 HTTP ${response.status}：${redact(rawMessage, apiKey)}`,
          { status: response.status, code: parsed?.error?.code ?? parsed?.code },
        );
        if (attempt === 0 && retryableStatus(response.status)) {
          lastError = error;
          if (debug) console.warn(`[qwen-omni-bridge] HTTP ${response.status}，1.5 秒后重试一次`);
          await sleep(1_500, signal);
          continue;
        }
        throw error;
      }
      const data = safeJson(text);
      if (!data || typeof data !== 'object') {
        throw new OmniApiError('qwen3.8-omni-flash 返回了无法解析的响应体。');
      }
      const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
      const answer = normalizeContent(choice?.message?.content);
      if (!answer) {
        throw new OmniApiError(
          `qwen3.8-omni-flash 未返回文本内容（finish_reason=${choice?.finish_reason ?? 'unknown'}）。`,
        );
      }
      if (debug) {
        console.log(
          `[qwen-omni-bridge] ${model} 完成：${Date.now() - startedAt}ms，` +
            `prompt=${data.usage?.prompt_tokens ?? '?'}，completion=${data.usage?.completion_tokens ?? '?'}`,
        );
      }
      return {
        text: answer,
        model: typeof data.model === 'string' ? data.model : model,
        usage: data.usage,
        requestId: typeof data.id === 'string' ? data.id : undefined,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('已取消');
      }
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new OmniApiError(`qwen3.8-omni-flash 调用超时（>${Math.round(timeoutMs / 1000)} 秒）。`);
      }
      if (error instanceof OmniApiError) throw error;
      lastError = error;
      if (attempt === 0 && error?.name === 'TypeError') {
        if (debug) console.warn(`[qwen-omni-bridge] 网络错误，1.2 秒后重试一次：${error.message}`);
        await sleep(1_200, signal);
        continue;
      }
      throw new OmniApiError(`qwen3.8-omni-flash 请求失败：${redact(error?.message ?? String(error), apiKey)}`);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new OmniApiError('qwen3.8-omni-flash 请求失败（未知错误）。');
}
