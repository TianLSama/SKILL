/**
 * 音乐识别：把内录得到的 WAV 交给已有的 qwen-omni-bridge 插件
 * （通过它注册的 `omni_media` 工具），由 qwen3.8-omni-flash 做多维度音乐特征分析。
 *
 * 这里不直接调用外部 API，也不重复读取桥接插件的配置：
 * 所有接入点、API Key、模型与推理强度都由桥接插件自身的配置决定。
 */

/** 多维度音乐特征分析提示词。 */
export const MUSIC_PROMPT = `你是音乐识别与音乐特征分析专家。下面是一段从电脑内录（系统回放）得到的音频片段，可能是正在播放的歌曲、纯音乐、影视/游戏配乐或环境音乐。

请只依据音频中实际听到的内容判断，不要编造；不确定的字段要明确写"不确定"。

先输出一个 JSON 代码块，字段如下（值一律用中文，数组没有内容时给空数组）：
{
  "title": "歌曲名；未能确定具体曲目时写：未能确定",
  "artist": "演唱者/乐队/作曲者",
  "version": "版本，如 原唱/翻唱/现场 Live/Remix/纯音乐/配乐",
  "language": "演唱或念白的语言",
  "genres": ["流派与子流派"],
  "moods": ["情绪与氛围"],
  "bpm": "估计的 BPM（用数字或区间，如 118 或 115-120）",
  "timeSignature": "拍号，如 4/4",
  "key": "调性，如 C 大调 / A 小调",
  "instruments": ["主要乐器与编曲元素"],
  "vocal": "人声特征（音色、音域、唱法、和声）；纯音乐写：无",
  "era": "可能的年代或制作风格",
  "lyrics": "能听清的歌词片段（逐字，最多两三句）",
  "similar": ["风格相近的作品或音乐人"],
  "confidence": 0.0,
  "summary": "一句话总结这段音乐"
}

JSON 之后输出中文分析，按小节展开：
1. 曲目识别与判断依据；
2. 节奏与律动（BPM、律动型态、强弱拍）；
3. 调性与和声（调式、和弦走向、色彩）；
4. 编曲与音色（乐器层次、混音特性）；
5. 人声表现（如有）；
6. 情绪与适用场景；
7. 相似作品与推荐；
8. 不确定的地方。

总字数控制在 1200 字以内。`;

/** 拼接出实际发送的提示词（可追加用户自定义要求）。 */
export function buildMusicPrompt(promptExtra = '') {
  const extra = typeof promptExtra === 'string' ? promptExtra.trim() : '';
  return extra ? `${MUSIC_PROMPT}\n\n额外要求：${extra}` : MUSIC_PROMPT;
}

/** 构造一个最小但可用的 ToolRunContext，供 omni_media 工具执行使用。 */
function createToolRunContext({ agent, signal, args, name }) {
  const callId = `song-id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    callId,
    rootCallId: callId,
    name,
    schema: undefined,
    arguments: args,
    agent,
    signal,
    token: Symbol('song-id-tool-call'),
    deferContext() {},
    concludeTurn() {},
  };
}

/**
 * 通过 qwen-omni-bridge 注册的 `omni_media` 工具识别录音。
 * @returns {Promise<{answer: string, model: string, media: Array<object>, note?: string}>}
 */
export async function identifyWithBridge({ wavPath, tools, agent, signal, effort, promptExtra, debug = false }) {
  if (!tools) throw new Error('工具服务不可用：无法调用 qwen-omni-bridge。');
  const definition = tools.get('omni_media');
  if (!definition || typeof definition.execute !== 'function') {
    throw new Error(
      '未找到 qwen-omni-bridge 提供的 omni_media 工具：请确认 @local/qwen-omni-bridge 已安装并启用，然后重试。',
    );
  }

  const args = {
    paths: [wavPath],
    prompt: buildMusicPrompt(promptExtra),
    reasoning_effort: effort,
  };
  if (debug) console.log(`[song-recognizer] 调用 omni_media 识别：${wavPath}（effort=${effort}）`);

  const value = await definition.execute(args, createToolRunContext({ agent, signal, args, name: 'omni_media' }));
  if (!value || typeof value !== 'object' || typeof value.answer !== 'string') {
    throw new Error('qwen-omni-bridge 返回了无法识别的结果。');
  }
  return value;
}

/**
 * 从模型回答里拆出结构化 JSON 与正文分析。
 * @param {string} answer
 * @returns {{ structured: object|null, body: string }}
 */
export function splitAnalysis(answer) {
  const text = typeof answer === 'string' ? answer : '';
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return { structured: null, body: text.trim() };
  let structured = null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) structured = parsed;
  } catch {
    structured = null;
  }
  const body = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
  return { structured, body };
}

/** 把识别结果整理成命令返回文本（含 JSON 块，供客户端卡片解析）。 */
export function buildAnalysisText({ answer, model, durationSeconds, wavBytes }) {
  const { structured, body } = splitAnalysis(answer);
  const meta = [
    `录制时长 ${durationSeconds.toFixed(1)} 秒`,
    `文件大小 ${(wavBytes / 1024 / 1024).toFixed(2)} MB`,
    `模型 ${model}`,
  ].join(' · ');
  const json = structured ? `\n\n\`\`\`json\n${JSON.stringify(structured, null, 2)}\n\`\`\`` : '';
  const bodyText = body ? `\n\n${body}` : '';
  return `${meta}${json}${bodyText}`;
}
