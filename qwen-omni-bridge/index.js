/**
 * Loader 入口。保持零 @deepseek-ai/* 依赖，避免 profile 安装时的模块解析问题。
 */
export { apply, inject, name, __test } from './lib/plugin.js';
export { analyzeMedia, buildPrompt, resolveMediaInput, autoPrompt } from './lib/analyze.js';
export { normalizeConfig, DEFAULT_BASE_URL, DEFAULT_MODEL } from './lib/config.js';
export { resolveApiKey } from './lib/key.js';
export { classifyByName, prepareInput, SAFE_INLINE_BYTES } from './lib/media.js';
