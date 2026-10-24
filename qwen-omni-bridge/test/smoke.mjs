/**
 * 本地冒烟测试（不依赖 DSH 运行时）：
 *   1. API Key 解析；
 *   2. 直接调用 qwen3.8-omni-flash 做音频转写 / 视频理解；
 *   3. 用假 ctx 装配插件，验证工具注册与 pre-step 自动路由；
 *   4. 大文件 ffmpeg 压缩/分段。
 *
 * 运行：node test/smoke.mjs
 * 依赖：工作区 .tmp-omni-test/speech.wav 与 test.mp4（由开发期测试生成）。
 */
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMedia, normalizeConfig, resolveApiKey } from '../index.js';
import { apply } from '../lib/plugin.js';
import { makeTempDir, prepareInput, removeTempDir } from '../lib/media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..');
const fixtures = path.join(workspace, '.tmp-omni-test');
const audioPath = path.join(fixtures, 'speech.wav');
const videoPath = path.join(fixtures, 'test.mp4');

function log(title, detail = '') {
  console.log(`\n=== ${title} ===${detail ? ` ${detail}` : ''}`);
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

function fakeContext(cwd = process.cwd()) {
  const state = { tools: [], sections: [], listeners: new Map() };
  const ctx = {
    state,
    tools: {
      register(definition) {
        state.tools.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section(section) {
        state.sections.push(section);
        return () => {};
      },
    },
    on(event, listener) {
      if (!state.listeners.has(event)) state.listeners.set(event, []);
      state.listeners.get(event).push(listener);
      return () => {};
    },
    attachments: { fileHostPath: () => undefined },
    workingDirectory: {
      defaultDirectory: cwd,
      async ensure() {
        return cwd;
      },
    },
  };
  return ctx;
}

async function main() {
  log('环境与配置读取');
  const key = resolveApiKey(undefined, ['ALIYUN_API_KEY', 'DASHSCOPE_API_KEY']);
  if (!key) {
    console.error('未找到 API Key，测试终止。');
    process.exitCode = 1;
    return;
  }
  console.log(`已找到密钥，来源：${key.source}（值已隐藏）`);

  const liveCfg = normalizeConfig({
    baseURL: { get: () => 'https://example.test/compatible-mode/v1/' },
    apiKey: { get: () => 'config-key' },
    apiKeyEnv: { get: () => 'ALIYUN_API_KEY' },
    model: { get: () => 'qwen3.8-omni-flash' },
    reasoningEffort: { get: () => 'none' },
    autoAnalyzeAttachments: { get: () => false },
    debug: { get: () => false },
  });
  assert.equal(liveCfg.baseURL, 'https://example.test/compatible-mode/v1');
  assert.equal(liveCfg.apiKey, 'config-key');
  assert.equal(liveCfg.autoAnalyzeAttachments, false);
  assert.equal(resolveApiKey('config-key', ['ALIYUN_API_KEY']).source, 'config.plugin-page');
  assert.equal(resolveApiKey('config-key', ['ALIYUN_API_KEY']).value, 'config-key');
  console.log('Schemastery accessor 与页面 Key 优先级读取正常');

  const hasAudio = await exists(audioPath);
  const hasVideo = await exists(videoPath);
  console.log(`测试素材：audio=${hasAudio} video=${hasVideo}`);

  const cfg = normalizeConfig({
    debug: true,
    reasoningEffort: 'none',
    autoAnalyzeMaxBytes: 8_000_000,
    autoAnalyzeTimeoutMs: 120_000,
    timeoutMs: 300_000,
  });

  if (hasAudio) {
    log('音频转写');
    const result = await analyzeMedia({
      inputs: [{ path: audioPath, kindHint: 'audio' }],
      prompt: '只回答：音频里提到了什么天气和什么时间开会？',
      cfg,
      cwd: workspace,
      timeoutMs: 120_000,
    });
    console.log(result.text.slice(0, 600));
    assert.ok(result.text.length > 0, '音频结果为空');
    assert.ok(result.media[0].kind === 'audio');
  }

  if (hasVideo) {
    log('视频理解');
    const result = await analyzeMedia({
      inputs: [{ path: videoPath, kindHint: 'video' }],
      prompt: '只回答：画面里有什么文字？',
      cfg,
      cwd: workspace,
      timeoutMs: 120_000,
    });
    console.log(result.text.slice(0, 600));
    assert.ok(result.text.length > 0, '视频结果为空');
    assert.ok(result.media[0].kind === 'video');
  }

  log('工具注册与参数校验');
  const ctx = fakeContext(workspace);
  apply(ctx, { autoAnalyzeAttachments: false, reasoningEffort: 'none', debug: true });
  assert.equal(ctx.state.tools.length, 1, '应注册一个工具');
  const tool = ctx.state.tools[0];
  assert.equal(tool.name, 'omni_media');
  assert.ok(ctx.state.sections.some((section) => section.name === 'qwen-omni-bridge'));
  const rendered = tool.output.render(
    { paths: ['x'] },
    { answer: '测试答案', model: 'qwen3.8-omni-flash', media: [{ path: 'x', kind: 'audio', bytes: 1, segments: 1 }] },
  );
  assert.match(rendered[0].text, /测试答案/);
  await assert.rejects(() => tool.execute({ paths: [] }, { agent: { id: 'a' }, signal: new AbortController().signal }));

  if (hasAudio) {
    log('工具真实执行');
    const value = await tool.execute(
      { paths: [audioPath], prompt: '只回答：音频里提到的气温是多少度？' },
      { agent: { id: 'test-agent' }, signal: new AbortController().signal },
    );
    console.log(value.answer.slice(0, 500));
    assert.ok(value.answer.length > 0);
    assert.equal(value.media[0].kind, 'audio');
  }

  if (hasAudio) {
    log('pre-step 自动路由');
    const autoCtx = fakeContext(workspace);
    autoCtx.attachments.fileHostPath = () => audioPath;
    apply(autoCtx, { autoAnalyzeAttachments: true, reasoningEffort: 'none', debug: true });
    const listener = autoCtx.state.listeners.get('agent/pre-step')?.[0];
    assert.ok(listener, '应注册 pre-step 监听器');
    const message = {
      id: 'm-test-1',
      role: 'user',
      source: { kind: 'user' },
      content: [
        { type: 'file', attachment: { attachmentId: 'att-test-1', name: 'speech.wav', bytes: 515824 } },
        { type: 'text', text: '这段音频在说什么？' },
      ],
    };
    const decision = await listener(
      { agent: { id: 'test-agent' }, messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    );
    assert.equal(decision.kind, 'enter');
    assert.equal(decision.messages.length, 2, '应在原消息后插入一条分析消息');
    const injectedMessage = decision.messages.find((item) => item.source?.kind === 'qwen-omni-bridge');
    assert.ok(injectedMessage, '应插入 qwen-omni-bridge 来源的消息');
    const injected = injectedMessage.content.find(
      (block) => block.type === 'text' && block.text.includes('<omni-media-analysis'),
    );
    assert.ok(injected, '应注入 <omni-media-analysis>');
    console.log(injected.text.slice(0, 500));
    assert.match(injected.text, /attachment="att-test-1"/);
  }

  log('大文件压缩/分段');
  const tempDir = await makeTempDir();
  const large = path.join(tempDir, 'large.mp3');
  const { execFile } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1000', '-c:a', 'libmp3lame', '-b:a', '128k', large],
      { timeout: 120_000 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  const largeStat = await fsp.stat(large);
  console.log(`生成测试音频：${(largeStat.size / 1024 / 1024).toFixed(1)} MB`);
  assert.ok(largeStat.size > 7_000_000, '测试音频应超过内联上限');
  const prepared = await prepareInput(
    { path: large, kindHint: 'audio' },
    { cfg, tempDir, signal: new AbortController().signal },
  );
  const audioParts = prepared.parts.filter((part) => part.type === 'input_audio');
  console.log(`分段数：${prepared.meta.segments}，内容分片：${audioParts.length}`);
  assert.ok(prepared.meta.segments >= 2, '应切分为至少 2 段');
  assert.equal(audioParts.length, prepared.meta.segments);
  for (const part of audioParts) {
    const length = part.input_audio.data.length;
    assert.ok(length < 10 * 1024 * 1024, `分段 base64 过长：${length}`);
  }
  await removeTempDir(tempDir);

  log('全部测试通过');
}

main().catch((error) => {
  console.error('\n测试失败：', error);
  process.exitCode = 1;
});
