/**
 * Loader 入口。
 * 唯一外部依赖是 @deepseek-ai/schemastery（用于插件管理页面的 Config 表单）。
 */
export { apply, inject, name, Config, __test } from './lib/plugin.js';
export { normalizeConfig, DEFAULT_COMMAND } from './lib/config.js';
export {
  MUSIC_PROMPT,
  DEFAULT_SEARCH_SITES,
  buildModelFollowup,
  buildMusicPrompt,
  identifyWithBridge,
  splitAnalysis,
  buildAnalysisText,
} from './lib/identify.js';
export {
  cancelRecording,
  cleanupSession,
  currentSession,
  readWavInfo,
  startRecording,
  stopAndCollect,
} from './lib/recorder.js';
