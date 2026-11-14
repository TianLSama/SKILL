/**
 * 系统声音（WASAPI loopback）录音进程管理。
 *
 * 录音由一个独立的后台 PowerShell 进程完成（scripts/loopback-record.ps1）：
 * 插件只负责启动、等待就绪、写入停止标志、收集结果与清理临时目录。
 * 全过程不涉及麦克风，录制的是系统默认播放设备正在输出的声音。
 */
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const state = { current: null };

/** 等待若干毫秒。 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 当前录音会话；没有则为 undefined。 */
export function currentSession() {
  return state.current;
}

/** 读取 WAV 头，得到采样率、时长与数据量（不依赖 ffprobe）。 */
export async function readWavInfo(wavPath) {
  const buffer = await fsp.readFile(wavPath);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { bytes: buffer.length, durationSeconds: 0, sampleRate: 0, channels: 0, bits: 0, dataBytes: 0 };
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      byteRate = buffer.readUInt32LE(body + 8);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataBytes = Math.min(size, Math.max(0, buffer.length - body));
      break;
    }
    offset = body + size + (size % 2);
  }
  const durationSeconds = byteRate > 0 ? dataBytes / byteRate : 0;
  return { bytes: buffer.length, durationSeconds, sampleRate, channels, bits, dataBytes };
}

function describeExit(session) {
  if (session.spawnError) return `录音进程启动失败：${session.spawnError.message}`;
  const stderr = (session.stderr || '').trim();
  if (stderr) return stderr.slice(-1200);
  return `录音进程已退出（exit=${session.exitCode ?? 'unknown'}）。`;
}

/**
 * 开始一次内录。
 * @param {object} options
 * @param {string} options.cwd 临时录音目录所在的工作目录
 * @param {string} options.scriptPath loopback-record.ps1 的绝对路径
 * @param {number} options.maxSeconds 最长录音秒数
 * @param {string} [options.pwshPath] PowerShell 可执行文件
 * @param {boolean} [options.debug]
 */
export async function startRecording({ cwd, scriptPath, maxSeconds, pwshPath = 'pwsh', debug = false }) {
  if (state.current && !state.current.exited) {
    throw new Error('已经在录音中：请先结束当前录音。');
  }
  if (state.current) {
    // 上一轮已自行结束（例如到达最长时长），清理它的临时目录。
    await cleanupSession(state.current);
    state.current = null;
  }

  const baseDir = path.join(cwd, '.dsh-song-id');
  await fsp.mkdir(baseDir, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(baseDir, 'session-'));
  const wavPath = path.join(dir, 'audio.wav');
  const stopFlag = path.join(dir, 'stop.flag');
  const readyFlag = path.join(dir, 'ready.flag');
  const startedAt = Date.now();

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-OutputPath',
    wavPath,
    '-StopFlag',
    stopFlag,
    '-ReadyFlag',
    readyFlag,
    '-MaxSeconds',
    String(maxSeconds),
  ];
  if (debug) console.log('[song-recognizer] 启动录音进程：', pwshPath, args.join(' '));

  const proc = spawn(pwshPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const session = {
    proc,
    dir,
    wavPath,
    stopFlag,
    readyFlag,
    startedAt,
    endedAt: undefined,
    exited: false,
    exitCode: null,
    stderr: '',
    spawnError: undefined,
  };
  proc.stderr?.on('data', (chunk) => {
    session.stderr = `${session.stderr}${chunk.toString('utf8')}`.slice(-8000);
  });
  proc.on('exit', (code, signal) => {
    session.exited = true;
    session.exitCode = code;
    session.signal = signal;
    session.endedAt = Date.now();
  });
  proc.on('error', (error) => {
    session.exited = true;
    session.spawnError = error;
    session.endedAt = Date.now();
  });
  state.current = session;

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (session.spawnError) throw new Error(describeExit(session));
    try {
      await fsp.access(readyFlag);
      session.readyAt = Date.now();
      if (debug) console.log(`[song-recognizer] 录音已开始：${wavPath}`);
      return session;
    } catch {
      // 尚未就绪，继续等待。
    }
    if (session.exited) throw new Error(describeExit(session));
    await sleep(120);
  }
  try {
    proc.kill();
  } catch {
    // 忽略。
  }
  throw new Error(`录音进程启动超时：${describeExit(session)}`);
}

/** 写入停止标志并等待录音进程退出；返回收集好的录音信息。 */
export async function finishSession(session, { timeoutMs = 30_000, debug = false } = {}) {
  if (!session) throw new Error('当前没有正在进行的录音。');
  if (!session.exited) {
    try {
      await fsp.writeFile(session.stopFlag, new Date().toISOString(), 'utf8');
    } catch (error) {
      if (debug) console.warn('[song-recognizer] 写入停止标志失败：', error?.message);
    }
    const deadline = Date.now() + timeoutMs;
    while (!session.exited && Date.now() < deadline) await sleep(100);
    if (!session.exited) {
      try {
        session.proc.kill();
      } catch {
        // 忽略。
      }
      throw new Error('录音进程在超时内没有结束，已强制终止。');
    }
  }
  if (session.spawnError) throw new Error(describeExit(session));
  if (session.exitCode !== 0) throw new Error(describeExit(session));

  let stat;
  try {
    stat = await fsp.stat(session.wavPath);
  } catch {
    throw new Error(`没有找到录音文件：${session.wavPath}`);
  }
  if (stat.size <= 44) {
    throw new Error('录音文件为空：内录期间没有捕获到声音。请确认电脑正在播放音乐，且系统有可用的播放设备。');
  }
  const info = await readWavInfo(session.wavPath);
  return { ...info, wavPath: session.wavPath, dir: session.dir };
}

/** 删除一次录音的临时目录。 */
export async function cleanupSession(session) {
  if (!session) return;
  try {
    await fsp.rm(session.dir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败。
  }
}

/** 停止并删除当前录音（取消）。 */
export async function cancelRecording({ timeoutMs = 15_000 } = {}) {
  const session = state.current;
  if (!session) return { cancelled: false };
  state.current = null;
  try {
    if (!session.exited) {
      try {
        await fsp.writeFile(session.stopFlag, 'cancel', 'utf8');
      } catch {
        // 忽略。
      }
      const deadline = Date.now() + timeoutMs;
      while (!session.exited && Date.now() < deadline) await sleep(100);
      if (!session.exited) {
        try {
          session.proc.kill();
        } catch {
          // 忽略。
        }
      }
    }
  } finally {
    await cleanupSession(session);
  }
  return { cancelled: true };
}

/** 结束录音并保留文件，供识别使用。 */
export async function stopAndCollect({ timeoutMs = 30_000, debug = false } = {}) {
  const session = state.current;
  if (!session) throw new Error('当前没有正在进行的录音。请先发送 `/song-id start`（或使用 /听歌识曲 弹窗开始录音）。');
  state.current = null;
  return await finishSession(session, { timeoutMs, debug });
}
