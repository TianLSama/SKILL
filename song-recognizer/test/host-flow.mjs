/**
 * Host 编排测试：用假的 Cordis Context 加载插件，真实启动/结束一次内录，
 * 验证 /song-id start|status|stop 命令处理器、临时目录清理与结果文本格式。
 * omni_media 工具在这里被替换成 stub（真实识别另见 README 验证记录）。
 *
 * 运行：node test/host-flow.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const work = path.join(root, '.tmp-flow');
const song = process.env.SONG_FILE || '';

function log(...args) {
  console.log('[host-flow]', ...args);
}

async function main() {
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });

  const registered = [];
  const ctx = {
    tools: {
      get(name) {
        if (name !== 'omni_media') return undefined;
        return {
          async execute(args) {
            assert.ok(Array.isArray(args.paths) && args.paths.length === 1, 'omni_media 应收到一个路径');
            assert.match(args.prompt, /多维度|BPM|调性/);
            return {
              answer: '```json\n{"title":"测试曲","artist":"测试歌手","bpm":"120"}\n```\n\n这是一段测试分析。',
              model: 'stub-omni',
              media: [{ path: args.paths[0], kind: 'audio', bytes: 1, segments: 1 }],
            };
          },
        };
      },
    },
    commands: {
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
    workingDirectory: {
      defaultDirectory: work,
      async ensure() {
        return work;
      },
    },
    systemPrompt: {
      section() {
        return () => {};
      },
    },
  };

  const { apply } = await import('../index.js');
  apply(ctx, { maxSeconds: 30, debug: true });

  const command = registered.find((item) => item.name === 'song-id');
  assert.ok(command, '应该注册 song-id 命令');
  assert.match(command.description, /内录/);

  const signal = new AbortController().signal;
  const invoke = (rawInput) => command.handler({ agent: { id: 'test-agent' }, rawInput, signal });

  const statusBefore = await invoke('status');
  assert.equal(statusBefore.kind, 'success');
  assert.match(statusBefore.text, /没有正在进行的录音/);

  const player = song
    ? spawn('ffplay', ['-ss', '40', '-t', '25', '-autoexit', '-nodisp', '-loglevel', 'quiet', song], {
        windowsHide: true,
        stdio: 'ignore',
      })
    : undefined;
  if (player) log('播放测试音频：', song);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  try {
    const started = await invoke('start');
    assert.equal(started.kind, 'success');
    assert.match(started.text, /已开始录制电脑声音/);
    log('start 返回：', started.text.split('\n')[0]);

    const dirs1 = await fsp.readdir(path.join(work, '.dsh-song-id'));
    assert.ok(dirs1.length >= 1, '应创建录音会话目录');

    const statusDuring = await invoke('status');
    assert.match(statusDuring.text, /正在录制电脑声音/);

    await new Promise((resolve) => setTimeout(resolve, 6000));

    const stopped = await invoke('stop');
    assert.equal(stopped.kind, 'success', `stop 失败：${stopped.text}`);
    assert.match(stopped.text, /录制时长/);
    assert.match(stopped.text, /"title": "测试曲"/);
    assert.match(stopped.text, /这是一段测试分析/);
    log('stop 返回前 120 字：', stopped.text.slice(0, 120).replace(/\n/g, ' '));

    const dirs2 = await fsp.readdir(path.join(work, '.dsh-song-id'));
    assert.equal(dirs2.length, 0, '默认应清理临时录音目录');

    const stopAgain = await invoke('stop');
    assert.equal(stopAgain.kind, 'error');
    assert.match(stopAgain.text, /没有正在进行的录音/);

    const unknown = await invoke('bogus');
    assert.equal(unknown.kind, 'error');

    const cancelIdle = await invoke('cancel');
    assert.match(cancelIdle.text, /没有正在进行的录音|已取消/);

    log('✅ Host 命令编排测试通过');
  } finally {
    if (player) player.kill();
    await fsp.rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[host-flow] ❌', error);
  process.exitCode = 1;
});
