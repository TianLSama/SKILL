/**
 * 本地冒烟测试：不连接 DSH，只验证纯逻辑与脚本存在性。
 * 运行：node test/smoke.mjs
 * 可选：node test/smoke.mjs --record（额外跑一次 4 秒内录）
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, promises as fsp, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../lib/config.js';
import { buildAnalysisText, buildModelFollowup, buildMusicPrompt, DEFAULT_SEARCH_SITES, MUSIC_PROMPT, splitAnalysis } from '../lib/identify.js';
import { __test as pluginTest } from '../lib/plugin.js';
import { readWavInfo } from '../lib/recorder.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientSource = readFileSync(path.join(root, 'client.js'), 'utf8');
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`✅ ${name}`);
  } catch (error) {
    results.push(`❌ ${name}：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}

check('normalizeConfig 默认值', () => {
  const cfg = normalizeConfig(undefined);
  assert.equal(cfg.maxSeconds, 90);
  assert.equal(cfg.reasoningEffort, 'xhigh');
  assert.equal(cfg.keepRecording, false);
});

check('normalizeConfig 兼容 volatile 访问器', () => {
  const cfg = normalizeConfig({
    maxSeconds: { get: () => 42 },
    reasoningEffort: { get: () => 'medium' },
    keepRecording: { get: () => true },
  });
  assert.equal(cfg.maxSeconds, 42);
  assert.equal(cfg.reasoningEffort, 'medium');
  assert.equal(cfg.keepRecording, true);
});

check('parseAction 支持中英文与默认值', () => {
  assert.equal(pluginTest.parseAction(''), 'start');
  assert.equal(pluginTest.parseAction('start'), 'start');
  assert.equal(pluginTest.parseAction(' STOP '), 'stop');
  assert.equal(pluginTest.parseAction('取消'), 'cancel');
  assert.equal(pluginTest.parseAction('状态'), 'status');
  assert.equal(pluginTest.parseAction('unknown'), undefined);
});

check('splitAnalysis 拆分 JSON 块与正文', () => {
  const answer = '```json\n{"title":"晴天","artist":"周杰伦"}\n```\n\n这是一段分析。';
  const { structured, body } = splitAnalysis(answer);
  assert.equal(structured.title, '晴天');
  assert.match(body, /这是一段分析/);
});

check('splitAnalysis 容忍没有 JSON 的回答', () => {
  const { structured, body } = splitAnalysis('只有文字。');
  assert.equal(structured, null);
  assert.equal(body, '只有文字。');
});

check('buildAnalysisText 包含 JSON 块与元信息', () => {
  const text = buildAnalysisText({
    answer: '```json\n{"title":"t"}\n```\n正文',
    model: 'qwen3.8-omni-flash',
    durationSeconds: 12.34,
    wavBytes: 1024 * 1024,
  });
  assert.match(text, /录制时长 12\.3 秒/);
  assert.match(text, /```json/);
  assert.match(text, /"title": "t"/);
});

check('buildModelFollowup 有歌词时生成核对请求', () => {
  const text = buildModelFollowup({
    structured: { title: 't', artist: 'a', language: '日语', lyrics: '君の名前を呼ぶ' },
    durationSeconds: 12.34,
  });
  assert.ok(text.includes('<听歌识曲-识别结果>'));
  assert.match(text, /君の名前を呼ぶ/);
  assert.match(text, /约 12\.3 秒/);
  assert.match(text, /网易云音乐/);
  assert.match(text, /萌娘百科/);
  assert.match(text, /不要编造/);
  assert.match(text, /## 识别摘要/);
});

check('buildModelFollowup 无歌词时只整理音乐特征', () => {
  const text = buildModelFollowup({
    structured: { title: '未能确定', artist: '未能确定', bpm: '120', key: 'C 大调', lyrics: '' },
    durationSeconds: 9,
  });
  assert.ok(text.includes('（本次没有听清可用的歌词）'));
  assert.match(text, /曲目无法确定/);
  assert.match(text, /BPM：120/);
  assert.doesNotMatch(text, /按歌词联网匹配这首歌/);
});

check('buildModelFollowup 支持自定义站点与正文', () => {
  const text = buildModelFollowup({
    structured: { lyrics: 'abc' },
    analysisBody: '一段分析正文。',
    searchSites: '某音乐站',
  });
  assert.match(text, /某音乐站/);
  assert.match(text, /一段分析正文/);
});

check('buildModelFollowup 没有内容时返回 null', () => {
  assert.equal(buildModelFollowup({ structured: { lyrics: '' } }), null);
  assert.equal(buildModelFollowup({ structured: null }), null);
  assert.ok(DEFAULT_SEARCH_SITES.includes('酷狗音乐'));
});

check('提示词覆盖多维度分析', () => {
  for (const key of ['BPM', '调性', '流派', '乐器', '情绪', 'confidence']) {
    assert.ok(MUSIC_PROMPT.includes(key), `提示词缺少 ${key}`);
  }
  assert.match(buildMusicPrompt('只看曲风'), /额外要求：只看曲风/);
});

check('recorder 脚本路径与 client 语法', () => {
  assert.ok(pluginTest.RECORD_SCRIPT.endsWith('loopback-record.ps1'));
  execFileSync(process.execPath, ['--check', path.join(root, 'client.js')]);
});

check('client.js 注册 /听歌识曲 与 shell.overlay', () => {
  assert.match(clientSource, /听歌识曲/);
  assert.match(clientSource, /shell\.overlay/);
  assert.match(clientSource, /commandUi/);
  assert.match(clientSource, /const HOST_COMMAND = 'song-id'/);
  assert.equal(pluginTest.COMMAND_NAME, 'song-id');
});

const wavPath = path.join(root, '.tmp-test.wav');
check('readWavInfo 解析真实录音（如存在 .tmp-test.wav）', () => {
  try {
    accessSync(wavPath);
  } catch {
    results.push('⏭  readWavInfo：缺少 .tmp-test.wav（可用 --record 生成）');
    return;
  }
  const buffer = readFileSync(wavPath);
  assert.ok(buffer.length > 44);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
});

if (process.argv.includes('--record')) {
  const { spawn } = await import('node:child_process');
  const dir = await fsp.mkdtemp(path.join(root, '.tmp-record-'));
  const out = path.join(dir, 'audio.wav');
  const player = spawn('ffplay', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-autoexit', '-nodisp', '-loglevel', 'quiet'], { windowsHide: true, stdio: 'ignore' });
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pluginTest.RECORD_SCRIPT, '-OutputPath', out, '-MaxSeconds', '4'], { windowsHide: true, stdio: 'inherit' });
      proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`录音脚本退出码 ${code}`))));
    });
    const info = await readWavInfo(out);
    assert.ok(info.durationSeconds > 0.2);
    results.push(`✅ 真实内录：${info.durationSeconds.toFixed(2)} 秒，${info.sampleRate}Hz/${info.channels}ch/${info.bits}bit`);
    await fsp.copyFile(out, wavPath);
  } finally {
    player.kill();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

console.log(results.join('\n'));
