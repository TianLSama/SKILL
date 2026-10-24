/**
 * Loader 入口。
 * 唯一的外部依赖是 @deepseek-ai/schemastery（用于插件管理页面的 Config 表单）。
 */
export { apply, inject, name, Config, __test } from './lib/plugin.js';
export { analyzeMedia, buildPrompt, resolveMediaInput, autoPrompt } from './lib/analyze.js';
export { normalizeConfig, DEFAULT_BASE_URL, DEFAULT_MODEL } from './lib/config.js';
export { resolveApiKey } from './lib/key.js';
export { classifyByName, prepareInput, SAFE_INLINE_BYTES } from './lib/media.js';
