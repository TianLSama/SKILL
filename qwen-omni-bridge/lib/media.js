/**
 * 媒体准备：
 *   - 识别音频 / 视频 / 图片；
 *   - 小文件直接 base64 内联（DashScope 要求 `data:;base64,...`，编码后 < 10MB）；
 *   - 大文件或容器格式不受支持时，用 ffmpeg 转码并按段切分；
 *   - 严格限制可读取的路径，避免模型通过工具读取工作区外的任意文件。
 */
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** DashScope 对 Base64 媒体串的硬上限是 10MB，这里给编码开销留余量。 */
export const SAFE_INLINE_BYTES = 7_000_000;
const AUDIO_SEGMENT_SECONDS = 900;
const VIDEO_SEGMENT_SECONDS = 240;
const AUDIO_BITRATE_KBPS = 56;
const TARGET_BYTES_PER_SEGMENT = Math.floor(SAFE_INLINE_BYTES * 0.82);

const AUDIO_EXT = new Map([
  ['.wav', 'wav'],
  ['.mp3', 'mp3'],
  ['.aac', 'aac'],
  ['.amr', 'amr'],
  ['.3gp', '3gp'],
  ['.3gpp', '3gp'],
  ['.m4a', null],
  ['.wma', null],
  ['.ogg', null],
  ['.flac', null],
  ['.opus', null],
]);

const VIDEO_EXT = new Set(['.mp4', '.avi', '.mkv', '.mov', '.flv', '.wmv', '.m4v', '.webm', '.ts', '.mpg', '.mpeg']);
const IMAGE_EXT = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

const ffmpegReady = new Map();

/** 根据文件扩展名判断媒体类型。 */
export function classifyByName(name) {
  const clean = String(name ?? '').split(/[?#]/, 1)[0];
  const ext = path.extname(clean).toLowerCase();
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  return undefined;
}

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '未知大小';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function mediaKindLabel(kind) {
  return kind === 'audio' ? '音频' : kind === 'video' ? '视频' : kind === 'image' ? '图片' : '媒体';
}

/** 判断 child 是否位于 parent 内（不做大小写归一，Windows 由调用方传入 realpath）。 */
export function isInside(parent, child) {
  if (!parent || !child) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * 工作区白名单校验：只允许工作目录、DSH 附件目录，或显式开启 allowOutsideWorkspace。
 * @param {string} absolute
 * @param {{ cwd: string, attachmentsRoot?: string, allowOutside?: boolean }} options
 */
export function assertAllowedPath(absolute, { cwd, attachmentsRoot, allowOutside }) {
  if (allowOutside) return;
  if (isInside(cwd, absolute)) return;
  if (attachmentsRoot && isInside(attachmentsRoot, absolute)) return;
  throw new Error(
    `拒绝读取工作区外的文件：${absolute}。如确需读取，请在插件配置中设置 allowOutsideWorkspace: true。`,
  );
}

function run(command, args, { timeoutMs = 120_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('已取消'));
      return;
    }
    execFile(
      command,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim().slice(-900);
          const failure = new Error(`${path.basename(command)} 执行失败：${detail}`);
          failure.cause = error;
          reject(failure);
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

async function ensureFfmpeg(cfg) {
  const key = cfg.ffmpegPath;
  if (!ffmpegReady.has(key)) {
    ffmpegReady.set(
      key,
      run(cfg.ffmpegPath, ['-version'], { timeoutMs: 8_000 })
        .then(() => true)
        .catch(() => false),
    );
  }
  return ffmpegReady.get(key);
}

async function probeDuration(file, cfg, signal) {
  try {
    const { stdout } = await run(
      cfg.ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { timeoutMs: 20_000, signal },
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function readHead(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function magicKind(head) {
  const hex = head.toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image'; // PNG
  if (hex.startsWith('ffd8ff')) return 'image'; // JPEG
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image'; // GIF
  if (hex.startsWith('52494646') && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image';
  if (hex.startsWith('52494646') && head.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio';
  if (hex.startsWith('52494646') && head.subarray(8, 12).toString('ascii') === 'AVI ') return 'video';
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') return 'video';
  if (hex.startsWith('1a45dfa3')) return 'video'; // Matroska
  if (hex.startsWith('464c56')) return 'video'; // FLV
  if (hex.startsWith('3026b275')) return 'video'; // ASF/WMV
  if (hex.startsWith('2321414d52')) return 'audio'; // #!AMR
  if (hex.startsWith('494433') || /^ffe[0-9a-f]/.test(hex)) return 'audio'; // MP3
  if (hex.startsWith('4f676753')) return 'audio'; // Ogg
  return undefined;
}

async function detectKind(filePath, name) {
  const byName = classifyByName(name || filePath);
  if (byName) return byName;
  try {
    return magicKind(await readHead(filePath));
  } catch {
    return undefined;
  }
}

/** 对自动路由暴露类型探测：文件没有扩展名时也能靠魔数识别。 */
export async function detectMediaKind(filePath, name) {
  return detectKind(filePath, name);
}

function audioFormatFor(fileName) {
  const ext = path.extname(String(fileName ?? '')).toLowerCase();
  const format = AUDIO_EXT.get(ext);
  return format || 'mp3';
}

function directlySupported(kind, fileName) {
  const ext = path.extname(String(fileName ?? '')).toLowerCase();
  if (kind === 'audio') return AUDIO_EXT.has(ext) && AUDIO_EXT.get(ext) !== null;
  if (kind === 'video') return VIDEO_EXT.has(ext);
  return true;
}

function imageMimeFor(fileName) {
  return IMAGE_EXT.get(path.extname(String(fileName ?? '')).toLowerCase()) || 'image/png';
}

function label(meta, extra) {
  const name = String(meta.name ?? path.basename(meta.path ?? 'media')).replace(/[\r\n"]/g, ' ');
  const suffix = extra ? `，${extra}` : '';
  return `【文件：${name}（${mediaKindLabel(meta.kind)}，${formatBytes(meta.bytes)}${suffix}）】`;
}

function dataUrl(buffer) {
  return `data:;base64,${buffer.toString('base64')}`;
}

function mediaPart(buffer, kind, fileName) {
  if (kind === 'audio') {
    return {
      type: 'input_audio',
      input_audio: {
        data: dataUrl(buffer),
        format: audioFormatFor(fileName),
      },
    };
  }
  if (kind === 'video') {
    return { type: 'video_url', video_url: { url: dataUrl(buffer) } };
  }
  return {
    type: 'image_url',
    image_url: { url: `data:${imageMimeFor(fileName)};base64,${buffer.toString('base64')}` },
  };
}

function urlPart(kind, url) {
  if (kind === 'audio') {
    return {
      type: 'input_audio',
      input_audio: { data: url, format: audioFormatFor(url) },
    };
  }
  if (kind === 'video') return { type: 'video_url', video_url: { url } };
  return { type: 'image_url', image_url: { url } };
}

async function encodeSegment(source, kind, start, length, output, cfg, signal, qualityScale = 1) {
  const common = ['-y', '-ss', String(start)];
  if (length !== undefined) common.push('-t', String(length));
  common.push('-i', source);

  if (kind === 'audio') {
    const bitrate = Math.max(32, Math.round(AUDIO_BITRATE_KBPS * qualityScale));
    await run(
      cfg.ffmpegPath,
      [
        ...common,
        '-vn',
        '-ac', '1',
        '-ar', '24000',
        '-b:a', `${bitrate}k`,
        '-f', 'mp3',
        output,
      ],
      { timeoutMs: 300_000, signal },
    );
    return;
  }

  const seconds = length && length > 0 ? length : 60;
  const targetBits = TARGET_BYTES_PER_SEGMENT * 8;
  const rawKbps = Math.floor(targetBits / seconds / 1000) - 48;
  const bitrate = Math.round(Math.max(120, Math.min(900, rawKbps)) * qualityScale);
  const height = bitrate >= 450 ? 720 : bitrate >= 220 ? 540 : 480;
  await run(
    cfg.ffmpegPath,
    [
      ...common,
      '-vf', `scale=-2:${height}`,
      '-r', '2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${Math.round(bitrate * 1.25)}k`,
      '-bufsize', `${bitrate * 2}k`,
      '-c:a', 'aac',
      '-b:a', '48k',
      '-ac', '1',
      '-movflags', '+faststart',
      output,
    ],
    { timeoutMs: 600_000, signal },
  );
}

/**
 * 转码并切分。返回的每个分段都在 Base64 安全体积内。
 * @returns {Promise<Array<{ path: string, bytes: number, index: number, total: number, start: number, end: number }>>}
 */
async function encodeSegments(source, kind, duration, cfg, tempDir, signal) {
  const segmentSeconds = kind === 'audio' ? AUDIO_SEGMENT_SECONDS : VIDEO_SEGMENT_SECONDS;
  let total = duration > 0 ? Math.max(1, Math.ceil(duration / segmentSeconds)) : 1;
  if (total > cfg.maxSegments) {
    throw new Error(
      `媒体时长约 ${formatTime(duration)}，需要切分为 ${total} 段，超过上限 ${cfg.maxSegments} 段。` +
        `请先裁剪到约 ${formatTime(segmentSeconds * cfg.maxSegments)} 以内再分析。`,
    );
  }

  const extension = kind === 'audio' ? '.mp3' : '.mp4';
  const results = [];
  for (let index = 0; index < total; index += 1) {
    const start = index * segmentSeconds;
    const remaining = duration > 0 ? duration - start : undefined;
    const length = remaining !== undefined ? Math.min(segmentSeconds, remaining) : undefined;
    if (length !== undefined && length < 0.5) break;
    const output = path.join(tempDir, `segment-${String(index + 1).padStart(2, '0')}${extension}`);
    await encodeSegment(source, kind, start, length, output, cfg, signal, 1);
    let stat = await fsp.stat(output);
    if (stat.size > SAFE_INLINE_BYTES) {
      // 复杂画面/高码率源可能仍超限，降一档再试。
      await encodeSegment(source, kind, start, length, output, cfg, signal, 0.6);
      stat = await fsp.stat(output);
    }
    if (stat.size > SAFE_INLINE_BYTES) {
      throw new Error(
        `媒体分段 ${index + 1} 压缩后仍为 ${formatBytes(stat.size)}，超过内联上限。请裁剪视频或降低分辨率后重试。`,
      );
    }
    results.push({
      path: output,
      bytes: stat.size,
      index: index + 1,
      total,
      start,
      end: length !== undefined ? start + length : undefined,
    });
  }
  if (results.length === 0) throw new Error('ffmpeg 没有生成任何可用的媒体分段。');
  if (results.length !== total) total = results.length;
  for (const item of results) item.total = total;
  return results;
}

async function downscaleImage(source, cfg, tempDir, signal) {
  const output = path.join(tempDir, `image-${Date.now()}.jpg`);
  try {
    await run(
      cfg.ffmpegPath,
      ['-y', '-i', source, '-vf', "scale='min(2048,iw)':-2", '-q:v', '3', output],
      { timeoutMs: 60_000, signal },
    );
  } catch {
    await run(
      cfg.ffmpegPath,
      ['-y', '-i', source, '-vf', 'scale=1280:-2', '-q:v', '3', output],
      { timeoutMs: 60_000, signal },
    );
  }
  const stat = await fsp.stat(output);
  if (stat.size > SAFE_INLINE_BYTES) {
    throw new Error(`图片压缩后仍为 ${formatBytes(stat.size)}，超过内联上限。`);
  }
  return output;
}

/**
 * 把一个输入媒体准备成 Chat Completions 的 content parts。
 * @param {{ path?: string, url?: string, name?: string, kindHint?: 'audio'|'video'|'image' }} input
 * @param {{ cfg: object, tempDir: string, signal?: AbortSignal }} options
 */
export async function prepareInput(input, { cfg, tempDir, signal }) {
  const url = input.url || (isHttpUrl(input.path) ? input.path : undefined);
  if (url) {
    const name = input.name || path.basename(new URL(url).pathname) || 'remote-media';
    const kind = input.kindHint || classifyByName(name);
    if (!kind) throw new Error(`无法从 URL 判断媒体类型：${url}。请提供带扩展名的 URL。`);
    return {
      parts: [
        { type: 'text', text: `【文件：${name}（${mediaKindLabel(kind)}，远程 URL）】` },
        urlPart(kind, url),
      ],
      meta: { path: url, kind, bytes: 0, segments: 1 },
    };
  }

  const filePath = input.path;
  if (!filePath) throw new Error('媒体输入缺少 path 或 url。');
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error(`不是普通文件：${filePath}`);
  const name = input.name || path.basename(filePath);
  const kind = input.kindHint || (await detectKind(filePath, name));
  if (!kind) {
    throw new Error(
      `不支持的媒体类型：${name}。支持音频 wav/mp3/aac/amr/3gp，视频 mp4/avi/mkv/mov/flv/wmv，图片 png/jpg/webp/gif。`,
    );
  }

  if (kind === 'image') {
    if (stat.size <= SAFE_INLINE_BYTES) {
      const buffer = await fsp.readFile(filePath);
      return {
        parts: [{ type: 'text', text: label({ name, kind, bytes: stat.size, path: filePath }) }, mediaPart(buffer, kind, name)],
        meta: { path: filePath, kind, bytes: stat.size, segments: 1 },
      };
    }
    if (!(await ensureFfmpeg(cfg))) {
      throw new Error(`图片 ${name} 为 ${formatBytes(stat.size)}，超过内联上限，但未找到 ffmpeg，无法压缩。`);
    }
    const scaled = await downscaleImage(filePath, cfg, tempDir, signal);
    const buffer = await fsp.readFile(scaled);
    return {
      parts: [
        { type: 'text', text: label({ name, kind, bytes: stat.size, path: filePath }, '已压缩') },
        mediaPart(buffer, kind, scaled),
      ],
      meta: { path: filePath, kind, bytes: stat.size, segments: 1 },
    };
  }

  if (stat.size <= SAFE_INLINE_BYTES && directlySupported(kind, name)) {
    const buffer = await fsp.readFile(filePath);
    return {
      parts: [{ type: 'text', text: label({ name, kind, bytes: stat.size, path: filePath }) }, mediaPart(buffer, kind, name)],
      meta: { path: filePath, kind, bytes: stat.size, segments: 1 },
    };
  }

  if (!(await ensureFfmpeg(cfg))) {
    throw new Error(
      `文件 ${name} 为 ${formatBytes(stat.size)}（或容器格式需要转码），但未找到 ffmpeg。` +
        '请安装 ffmpeg 并在 PATH 中可用，或在插件配置中设置 ffmpegPath。',
    );
  }

  const duration = await probeDuration(filePath, cfg, signal);
  const segments = await encodeSegments(filePath, kind, duration, cfg, tempDir, signal);
  const parts = [
    {
      type: 'text',
      text: label(
        { name, kind, bytes: stat.size, path: filePath },
        segments.length > 1 ? `已转为 ${segments.length} 段` : '已转码',
      ),
    },
  ];
  for (const segment of segments) {
    const buffer = await fsp.readFile(segment.path);
    const range =
      segment.end !== undefined
        ? `第 ${segment.index}/${segment.total} 段，约 ${formatTime(segment.start)}–${formatTime(segment.end)}`
        : `第 ${segment.index}/${segment.total} 段`;
    parts.push({ type: 'text', text: `【${name} ${range}】` });
    parts.push(mediaPart(buffer, kind, segment.path));
  }
  return {
    parts,
    meta: { path: filePath, kind, bytes: stat.size, segments: segments.length },
  };
}

/** 测试辅助：创建临时目录。 */
export async function makeTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-omni-'));
}

/** 测试辅助：清理临时目录。 */
export async function removeTempDir(dir) {
  if (!dir) return;
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}
