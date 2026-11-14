/**
 * 听歌识曲客户端：
 *   1. 注册 `/听歌识曲` 命令（中文名，纯客户端命令），发送后弹出录音小窗；
 *   2. 小窗通过 Host 命令 `/song-id start|stop|cancel` 控制 WASAPI 内录并取回分析结果；
 *   3. 结果按多维度音乐特征卡片展示。
 *
 * 录音发生在 Host 进程（WASAPI loopback 内录系统回放），浏览器不申请麦克风权限。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-song-recognizer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'songRecognizer';
    const COMMAND_LABEL = '听歌识曲';
    const HOST_COMMAND = 'song-id';

    const zh = {
      'command.label': '听歌识曲',
      'command.description': '内录电脑声音，识别正在播放的歌曲并分析音乐特征',
      'title': '听歌识曲',
      'subtitle': '内录电脑声音 · 不使用麦克风',
      'starting': '正在启动内录…',
      'recording': '正在录制电脑声音',
      'recordingHint': '请让歌曲持续播放，建议录 10–20 秒；结束时点击下方按钮。',
      'elapsed': '已录 {seconds} 秒',
      'stop': '结束录音并识别',
      'analyzing': '正在分析音乐特征…',
      'analyzingHint': 'qwen3.8-omni-flash 正在识别曲目、节奏、调性与编曲，通常需要 10–40 秒。',
      'cancel': '取消并丢弃',
      'close': '关闭',
      'retry': '重新录音',
      'copy': '复制结果',
      'copied': '已复制',
      'copyFailed': '复制失败',
      'errorTitle': '识别未完成',
      'dismiss': '知道了',
      'resultTitle': '识别结果',
      'analysisTitle': '音乐分析',
      'confidence': '置信度',
      'unknown': '不确定',
      'field.version': '版本',
      'field.language': '语言',
      'field.genres': '流派',
      'field.moods': '情绪',
      'field.bpm': 'BPM',
      'field.timeSignature': '拍号',
      'field.key': '调性',
      'field.instruments': '乐器/编曲',
      'field.vocal': '人声',
      'field.era': '年代/风格',
      'field.lyrics': '歌词片段',
      'field.similar': '相似作品',
      'field.summary': '摘要',
      'config.summary': '配置最长录音时长、思考强度、PowerShell 路径与调试选项。',
      'config.maxSeconds': '最长录音秒数',
      'config.maxSecondsHint': '到达该时长后自动停止录音，范围 5–600。',
      'config.effort': '思考强度',
      'config.effortHint': 'none 最快，xhigh 最细但更慢。',
      'config.pwshPath': 'PowerShell 路径',
      'config.pwshPathHint': '运行内录脚本的 pwsh；默认从 PATH 查找。',
      'config.ffmpegPath': 'ffmpeg 路径',
      'config.ffmpegPathHint': '保留字段；当前直接解析 WAV 头读取时长。',
      'config.keepRecording': '保留录音文件',
      'config.keepRecordingHint': '识别后保留临时 WAV，便于排查问题。',
      'config.promptExtra': '附加要求',
      'config.promptExtraHint': '追加到音乐特征分析提示词末尾，例如「重点说明编曲与音色」。',
      'config.autoFollowup': '歌词联网核对',
      'config.autoFollowupHint': '识别出歌词后，自动把歌词片段发给主模型，用网络搜索到音乐站点按歌词匹配歌曲。',
      'config.searchSites': '歌词检索站点',
      'config.searchSitesHint': '主模型核对歌词时优先参考的站点，可用顿号或逗号分隔。',
      'config.debug': '调试日志',
      'config.debugHint': '输出调试日志（不含密钥）。',
      'config.save': '保存',
      'config.saving': '保存中…',
      'config.saved': '已保存',
      'config.saveFailed': '保存失败，请检查输入。',
      'config.loading': '正在读取配置…',
      'config.unavailable': '当前无法读取该插件配置。',
      'config.readOnly': '当前部署的设置为只读。',
    };

    const en = {
      'command.label': 'Identify song',
      'command.description': 'Record system audio and identify the playing song with a multi-dimensional music analysis',
      'title': 'Identify song',
      'subtitle': 'System audio loopback · no microphone',
      'starting': 'Starting the system-audio recorder…',
      'recording': 'Recording your computer\'s audio',
      'recordingHint': 'Keep the song playing; 10–20 seconds is usually enough. Stop with the button below.',
      'elapsed': 'Recorded {seconds}s',
      'stop': 'Stop and identify',
      'analyzing': 'Analyzing the music…',
      'analyzingHint': 'qwen3.8-omni-flash is identifying the track, tempo, key and arrangement; this usually takes 10–40 seconds.',
      'cancel': 'Cancel and discard',
      'close': 'Close',
      'retry': 'Record again',
      'copy': 'Copy result',
      'copied': 'Copied',
      'copyFailed': 'Copy failed',
      'errorTitle': 'Identification failed',
      'dismiss': 'Dismiss',
      'resultTitle': 'Result',
      'analysisTitle': 'Music analysis',
      'confidence': 'Confidence',
      'unknown': 'Uncertain',
      'field.version': 'Version',
      'field.language': 'Language',
      'field.genres': 'Genres',
      'field.moods': 'Mood',
      'field.bpm': 'BPM',
      'field.timeSignature': 'Time signature',
      'field.key': 'Key',
      'field.instruments': 'Instruments / arrangement',
      'field.vocal': 'Vocals',
      'field.era': 'Era / style',
      'field.lyrics': 'Lyrics',
      'field.similar': 'Similar works',
      'field.summary': 'Summary',
      'config.summary': 'Configure the maximum recording length, reasoning effort, PowerShell path and debug options.',
      'config.maxSeconds': 'Maximum recording seconds',
      'config.maxSecondsHint': 'Recording stops automatically at this length; range 5–600.',
      'config.effort': 'Reasoning effort',
      'config.effortHint': 'none is fastest; xhigh is the most thorough and slowest.',
      'config.pwshPath': 'PowerShell path',
      'config.pwshPathHint': 'The pwsh that runs the recorder script; defaults to PATH.',
      'config.ffmpegPath': 'ffmpeg path',
      'config.ffmpegPathHint': 'Reserved field; the duration is currently read from the WAV header.',
      'config.keepRecording': 'Keep the recording',
      'config.keepRecordingHint': 'Keep the temporary WAV after identification for troubleshooting.',
      'config.promptExtra': 'Extra instruction',
      'config.promptExtraHint': 'Appended to the music-analysis prompt, such as “focus on arrangement and timbre”.',
      'config.autoFollowup': 'Verify lyrics online',
      'config.autoFollowupHint': 'After identifying lyrics, send the snippet back to the main model so it can search music sites for a lyric match.',
      'config.searchSites': 'Lyric search sites',
      'config.searchSitesHint': 'Sites the main model should check first when matching lyrics; separate them with commas.',
      'config.debug': 'Debug logging',
      'config.debugHint': 'Log debug details without API keys.',
      'config.save': 'Save',
      'config.saving': 'Saving…',
      'config.saved': 'Saved',
      'config.saveFailed': 'Save failed; check the values and try again.',
      'config.loading': 'Reading the configuration…',
      'config.unavailable': 'This plugin configuration is not readable right now.',
      'config.readOnly': 'This deployment stores settings read-only.',
    };

    const COLORS = {
      card: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #ffffff))',
      border: 'var(--dsw-alias-border-l1, rgba(0,0,0,0.12))',
      label: 'var(--dsw-alias-label-primary, #1f2329)',
      secondary: 'var(--dsw-alias-label-secondary, #646a73)',
      brand: 'var(--dsw-alias-brand-primary, #247bbf)',
      error: 'var(--dsw-alias-state-error-primary, #d83931)',
      success: 'var(--dsw-alias-state-success-primary, #2ea121)',
      idle: 'var(--dsw-alias-state-idle-primary, #8f959e)',
    };

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get() {
          return state;
        },
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : patch;
          state = { ...state, ...next };
          for (const listener of listeners) listener();
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    }

    const store = createStore({
      open: false,
      phase: 'idle', // idle | starting | recording | analyzing | done | error
      startedAt: 0,
      elapsed: 0,
      error: '',
      result: null,
      meta: '',
      body: '',
      copied: false,
      session: null,
    });

    function formatSeconds(seconds) {
      const total = Math.max(0, Math.floor(seconds));
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(total % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    }

    function valueText(value) {
      if (value == null) return '';
      if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join('、');
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    /** 解析 Host 返回的识别文本：元信息行 + JSON 块 + 正文分析。 */
    function parseResultText(text) {
      const raw = typeof text === 'string' ? text : '';
      const match = raw.match(/```json\s*([\s\S]*?)```/i);
      let structured = null;
      let rest = raw;
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) structured = parsed;
        } catch {
          structured = null;
        }
        rest = `${raw.slice(0, match.index)}${raw.slice(match.index + match[0].length)}`;
      }
      const lines = rest.split('\n');
      const firstIndex = lines.findIndex((line) => line.trim());
      const meta = firstIndex >= 0 ? lines[firstIndex].trim() : '';
      const body = lines
        .slice(firstIndex + 1)
        .join('\n')
        .trim();
      return { structured, meta, body };
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'song-id: dictionaries');

      const tr = (key, vars) => {
        const text = t(key);
        if (!vars) return text;
        return String(text).replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? '' : String(vars[name])));
      };

      let ticker = null;
      function stopTicker() {
        if (ticker !== null) {
          clearInterval(ticker);
          ticker = null;
        }
      }
      function startTicker(startedAt) {
        stopTicker();
        ticker = setInterval(() => {
          store.set({ elapsed: (Date.now() - startedAt) / 1000 });
        }, 500);
      }

      async function callHost(action) {
        const session = store.get().session;
        if (!session || !session.sessionId) throw new Error('没有可用的会话上下文。');
        const remote = ctx.remote && ctx.remote.commands;
        if (!remote || typeof remote.execute !== 'function') throw new Error('命令服务不可用。');
        const line = `/${HOST_COMMAND} ${action}`.trim();
        const response = await remote.execute(session.sessionId, line, []);
        if (!response || response.ok !== true) {
          const message = response && response.error ? response.error.message : '命令调用失败';
          throw new Error(message);
        }
        if (response.value === undefined) throw new Error(`未找到命令：${line}`);
        return response.value.result;
      }

      function setError(message) {
        stopTicker();
        store.set({ phase: 'error', error: message, elapsed: 0, copied: false });
      }

      async function begin(session) {
        store.set({
          open: true,
          phase: 'starting',
          session,
          startedAt: 0,
          elapsed: 0,
          error: '',
          result: null,
          meta: '',
          body: '',
          copied: false,
        });
        try {
          const result = await callHost('start');
          if (result && result.kind === 'error') throw new Error(result.text || '无法开始录音');
          const startedAt = Date.now();
          store.set({ phase: 'recording', startedAt });
          startTicker(startedAt);
        } catch (error) {
          setError(error && error.message ? error.message : String(error));
        }
      }

      async function finish() {
        stopTicker();
        store.set({ phase: 'analyzing', error: '' });
        try {
          const result = await callHost('stop');
          if (!result || result.kind !== 'success') {
            throw new Error((result && result.text) || '识别失败');
          }
          const parsed = parseResultText(result.text);
          store.set({
            phase: 'done',
            result: parsed.structured,
            meta: parsed.meta,
            body: parsed.body,
            elapsed: store.get().elapsed,
          });
        } catch (error) {
          setError(error && error.message ? error.message : String(error));
        }
      }

      async function discard() {
        stopTicker();
        try {
          await callHost('cancel');
        } catch {
          // 取消失败不阻塞关闭。
        }
        store.set({ open: false, phase: 'idle', session: null, elapsed: 0 });
      }

      function close() {
        const phase = store.get().phase;
        if (phase === 'recording' || phase === 'starting') {
          void discard();
          return;
        }
        if (phase === 'analyzing') return;
        store.set({ open: false, phase: 'idle', session: null, elapsed: 0 });
      }

      ctx.effect(
        () =>
          ctx.commandUi.register({
            name: COMMAND_LABEL,
            label: () => tr('command.label'),
            description: () => tr('command.description'),
            available: () => true,
            ui: {
              kind: 'action',
              run: (session) => {
                void begin(session);
              },
            },
          }),
        'song-id: command',
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'song-id.panel',
            order: 60,
            locale: NS,
            inject: () => ({
              hooks: {},
              close,
              finish,
              discard,
              retry: () => {
                const session = store.get().session;
                if (session) void begin(session);
              },
            }),
          },
          SongIdPanel,
        ),
      );

      ctx.slots.inject('plugins.row.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.row.config',
            key: '@local/dsh-song-recognizer#song-recognizer',
            locale: NS,
          },
          RowConfigPage,
        ),
      );

      ctx.effect(() => () => {
        stopTicker();
        const session = store.get().session;
        const phase = store.get().phase;
        if (session && (phase === 'recording' || phase === 'starting')) {
          store.set({ open: false, phase: 'idle', session: null });
        }
      }, 'song-id: teardown');
    }

    const configFieldStyle = {
      width: '100%',
      height: 30,
      borderRadius: 6,
      border: `0.5px solid ${COLORS.border}`,
      background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      color: COLORS.label,
      font: 'inherit',
      fontSize: 13,
      padding: '0 8px',
      boxSizing: 'border-box',
    };

    const configLabelStyle = { fontSize: 12, fontWeight: 600, color: COLORS.label };

    const configHintStyle = { margin: 0, fontSize: 11, lineHeight: 1.5, color: COLORS.secondary };

    function ConfigField({ id, label, hint, children }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('label', { htmlFor: id, style: configLabelStyle }, label),
        children,
        h('p', { style: configHintStyle }, hint),
      );
    }

    function draftFromConfig(value) {
      const v = value && typeof value === 'object' ? value : {};
      return {
        maxSeconds: typeof v.maxSeconds === 'number' ? v.maxSeconds : 90,
        reasoningEffort: typeof v.reasoningEffort === 'string' ? v.reasoningEffort : 'xhigh',
        pwshPath: typeof v.pwshPath === 'string' ? v.pwshPath : 'pwsh',
        ffmpegPath: typeof v.ffmpegPath === 'string' ? v.ffmpegPath : 'ffmpeg',
        keepRecording: v.keepRecording === true,
        debug: v.debug === true,
        promptExtra: typeof v.promptExtra === 'string' ? v.promptExtra : '',
        autoLyricsFollowup: v.autoLyricsFollowup !== false,
        searchSites: typeof v.searchSites === 'string' ? v.searchSites : '',
      };
    }

    /** 插件管理页的「听歌识曲」行配置表单（Host Config schema 的浏览器端编辑入口）。 */
    function ConfigPanel({ t, form }) {
      const snapshot = form.state || {};
      const status = snapshot.status;
      const writable = snapshot.writable === true;
      const revision = snapshot.revision;
      const [draft, setDraft] = React.useState(() => draftFromConfig(snapshot.value));
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState('');

      React.useEffect(() => {
        setDraft(draftFromConfig(snapshot.value));
      }, [revision]);

      if (status === 'unavailable') {
        return h('p', { style: { margin: 0, fontSize: 12, color: COLORS.error } }, t('config.unavailable'));
      }
      if (status === 'loading') {
        return h('p', { style: { margin: 0, fontSize: 12, color: COLORS.secondary } }, t('config.loading'));
      }

      const edit = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
      const disabled = !writable || busy;

      const save = async () => {
        if (!writable || busy) return;
        setBusy(true);
        setMessage('');
        const ops = [];
        const setOp = (field, value) => ops.push({ op: 'set', path: [field], value });
        const textOp = (field, text) => {
          const trimmed = typeof text === 'string' ? text.trim() : '';
          if (trimmed) setOp(field, trimmed);
          else ops.push({ op: 'unset', path: [field] });
        };
        const seconds = Math.max(5, Math.min(600, Math.round(Number(draft.maxSeconds) || 90)));
        setOp('maxSeconds', seconds);
        setOp('reasoningEffort', draft.reasoningEffort);
        setOp('keepRecording', draft.keepRecording === true);
        setOp('debug', draft.debug === true);
        textOp('pwshPath', draft.pwshPath);
        textOp('ffmpegPath', draft.ffmpegPath);
        textOp('promptExtra', draft.promptExtra);
        setOp('autoLyricsFollowup', draft.autoLyricsFollowup === true);
        textOp('searchSites', draft.searchSites);
        try {
          const ok = await form.mutate(ops, revision);
          setMessage(ok ? t('config.saved') : t('config.saveFailed'));
        } catch (error) {
          setMessage(`${t('config.saveFailed')} ${error && error.message ? error.message : ''}`.trim());
        } finally {
          setBusy(false);
        }
      };

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 } },
        h(
          ConfigField,
          { id: 'song-id-max-seconds', label: t('config.maxSeconds'), hint: t('config.maxSecondsHint') },
          h('input', {
            id: 'song-id-max-seconds',
            type: 'number',
            min: 5,
            max: 600,
            value: String(draft.maxSeconds),
            disabled,
            onChange: (event) => edit('maxSeconds', event.target.value === '' ? '' : Number(event.target.value)),
            style: configFieldStyle,
          }),
        ),
        h(
          ConfigField,
          { id: 'song-id-effort', label: t('config.effort'), hint: t('config.effortHint') },
          h(
            'select',
            {
              id: 'song-id-effort',
              value: draft.reasoningEffort,
              disabled,
              onChange: (event) => edit('reasoningEffort', event.target.value),
              style: configFieldStyle,
            },
            ['none', 'low', 'medium', 'xhigh'].map((option) => h('option', { key: option, value: option }, option)),
          ),
        ),
        h(
          ConfigField,
          { id: 'song-id-pwsh', label: t('config.pwshPath'), hint: t('config.pwshPathHint') },
          h('input', {
            id: 'song-id-pwsh',
            type: 'text',
            value: draft.pwshPath,
            disabled,
            onChange: (event) => edit('pwshPath', event.target.value),
            style: configFieldStyle,
          }),
        ),
        h(
          ConfigField,
          { id: 'song-id-ffmpeg', label: t('config.ffmpegPath'), hint: t('config.ffmpegPathHint') },
          h('input', {
            id: 'song-id-ffmpeg',
            type: 'text',
            value: draft.ffmpegPath,
            disabled,
            onChange: (event) => edit('ffmpegPath', event.target.value),
            style: configFieldStyle,
          }),
        ),
        h(
          ConfigField,
          { id: 'song-id-extra', label: t('config.promptExtra'), hint: t('config.promptExtraHint') },
          h('textarea', {
            id: 'song-id-extra',
            rows: 2,
            value: draft.promptExtra,
            disabled,
            onChange: (event) => edit('promptExtra', event.target.value),
            style: { ...configFieldStyle, height: 'auto', padding: '6px 8px', resize: 'vertical', lineHeight: 1.5 },
          }),
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.label } },
          h('input', {
            type: 'checkbox',
            checked: draft.autoLyricsFollowup === true,
            disabled,
            onChange: (event) => edit('autoLyricsFollowup', event.target.checked),
          }),
          h('span', null, t('config.autoFollowup')),
        ),
        h('p', { style: configHintStyle }, t('config.autoFollowupHint')),
        h(
          ConfigField,
          { id: 'song-id-sites', label: t('config.searchSites'), hint: t('config.searchSitesHint') },
          h('textarea', {
            id: 'song-id-sites',
            rows: 2,
            value: draft.searchSites,
            disabled,
            onChange: (event) => edit('searchSites', event.target.value),
            style: { ...configFieldStyle, height: 'auto', padding: '6px 8px', resize: 'vertical', lineHeight: 1.5 },
          }),
        ),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.label } },
          h('input', {
            type: 'checkbox',
            checked: draft.keepRecording === true,
            disabled,
            onChange: (event) => edit('keepRecording', event.target.checked),
          }),
          h('span', null, t('config.keepRecording')),
        ),
        h('p', { style: configHintStyle }, t('config.keepRecordingHint')),
        h(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.label } },
          h('input', {
            type: 'checkbox',
            checked: draft.debug === true,
            disabled,
            onChange: (event) => edit('debug', event.target.checked),
          }),
          h('span', null, t('config.debug')),
        ),
        h('p', { style: configHintStyle }, t('config.debugHint')),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              onClick: save,
              disabled,
              style: {
                border: 'none',
                background: disabled ? COLORS.idle : COLORS.brand,
                color: 'var(--dsw-alias-bg-base, #ffffff)',
                borderRadius: 8,
                padding: '7px 16px',
                fontSize: 12,
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
              },
            },
            busy ? t('config.saving') : t('config.save'),
          ),
          message ? h('span', { style: { fontSize: 12, color: COLORS.secondary } }, message) : null,
          !writable ? h('span', { style: { fontSize: 12, color: COLORS.idle } }, t('config.readOnly')) : null,
        ),
      );
    }

    /** `plugins.row.config` 入口：`summary` 一行说明，`page` 渲染表单。 */
    function RowConfigPage(props) {
      const { t, view, form } = props;
      if (view === 'summary') return t('config.summary');
      if (!form) return null;
      return h(ConfigPanel, { t, form });
    }

    function FieldGrid({ structured, t }) {
      const order = [
        'version',
        'language',
        'genres',
        'moods',
        'bpm',
        'timeSignature',
        'key',
        'instruments',
        'vocal',
        'era',
        'lyrics',
        'similar',
      ];
      const rows = [];
      for (const key of order) {
        const text = valueText(structured[key]);
        if (!text) continue;
        rows.push(
          h(
            'div',
            { key, style: { display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 } },
            h(
              'span',
              {
                style: {
                  flex: '0 0 84px',
                  color: COLORS.secondary,
                  fontSize: 12,
                  paddingTop: 1,
                },
              },
              t(`field.${key}`),
            ),
            h(
              'span',
              { style: { flex: 1, color: COLORS.label, fontSize: 13, wordBreak: 'break-word' } },
              text,
            ),
          ),
        );
      }
      if (rows.length === 0) return null;
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, rows);
    }

    function SongIdPanel(props) {
      const state = React.useSyncExternalStore(store.subscribe, store.get);
      const t = props.t;
      const [copyState, setCopyState] = React.useState('');

      React.useEffect(() => {
        if (!state.open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            props.close();
          }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      }, [state.open, props.close]);

      React.useEffect(() => {
        if (copyState === '') return undefined;
        const timer = setTimeout(() => setCopyState(''), 1800);
        return () => clearTimeout(timer);
      }, [copyState]);

      if (!state.open) return null;

      const recording = state.phase === 'recording';
      const analyzing = state.phase === 'analyzing';
      const starting = state.phase === 'starting';
      const done = state.phase === 'done';
      const failed = state.phase === 'error';
      const structured = state.result || {};

      const copy = async () => {
        const structuredText = state.result ? `${valueText(structured.title) || ''} ${valueText(structured.artist) || ''}`.trim() : '';
        const text = [structuredText, state.meta, state.body].filter(Boolean).join('\n\n');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          setCopyState('copied');
        } catch {
          setCopyState('failed');
        }
      };

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 15, fontWeight: 600, color: COLORS.label } }, t('title')),
            h(
              'span',
              { style: { fontSize: 11, color: COLORS.secondary, border: `0.5px solid ${COLORS.border}`, borderRadius: 999, padding: '1px 8px' } },
              t('subtitle'),
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: props.close,
            disabled: analyzing,
            'aria-label': t('close'),
            style: {
              border: 'none',
              background: 'transparent',
              color: analyzing ? COLORS.idle : COLORS.secondary,
              cursor: analyzing ? 'not-allowed' : 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: 6,
            },
          },
          '✕',
        ),
      );

      let body;
      if (starting) {
        body = h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0' } },
          h('span', {
            style: {
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: COLORS.brand,
              animation: 'songIdPulse 1.2s ease-in-out infinite',
            },
          }),
          h('span', { style: { color: COLORS.label, fontSize: 13 } }, t('starting')),
        );
      } else if (recording) {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 0 4px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', {
              style: {
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: COLORS.error,
                boxShadow: '0 0 0 4px rgba(216,57,49,0.16)',
                animation: 'songIdPulse 1.2s ease-in-out infinite',
              },
            }),
            h('span', { style: { color: COLORS.label, fontSize: 13, fontWeight: 600 } }, t('recording')),
            h(
              'span',
              {
                style: {
                  marginLeft: 'auto',
                  fontVariantNumeric: 'tabular-nums',
                  color: COLORS.secondary,
                  fontSize: 13,
                },
              },
              formatSeconds(state.elapsed),
            ),
          ),
          h('p', { style: { margin: 0, color: COLORS.secondary, fontSize: 12, lineHeight: 1.6 } }, t('recordingHint')),
          h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 } },
            h(
              'button',
              {
                type: 'button',
                onClick: props.discard,
                style: {
                  border: `0.5px solid ${COLORS.border}`,
                  background: 'transparent',
                  color: COLORS.secondary,
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                },
              },
              t('cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: props.finish,
                style: {
                  border: 'none',
                  background: COLORS.brand,
                  color: 'var(--dsw-alias-bg-base, #ffffff)',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                },
              },
              t('stop'),
            ),
          ),
        );
      } else if (analyzing) {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 0' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', {
              style: {
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: COLORS.brand,
                animation: 'songIdPulse 1.2s ease-in-out infinite',
              },
            }),
            h('span', { style: { color: COLORS.label, fontSize: 13, fontWeight: 600 } }, t('analyzing')),
          ),
          h('p', { style: { margin: 0, color: COLORS.secondary, fontSize: 12, lineHeight: 1.6 } }, t('analyzingHint')),
        );
      } else if (failed) {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0 4px' } },
          h('div', { style: { color: COLORS.error, fontSize: 13, fontWeight: 600 } }, t('errorTitle')),
          h(
            'div',
            { style: { color: COLORS.secondary, fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word', maxHeight: 160, overflow: 'auto' } },
            state.error || '',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            h(
              'button',
              {
                type: 'button',
                onClick: () => store.set({ open: false, phase: 'idle', session: null }),
                style: {
                  border: `0.5px solid ${COLORS.border}`,
                  background: 'transparent',
                  color: COLORS.secondary,
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                },
              },
              t('dismiss'),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: props.retry,
                style: {
                  border: 'none',
                  background: COLORS.brand,
                  color: 'var(--dsw-alias-bg-base, #ffffff)',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                },
              },
              t('retry'),
            ),
          ),
        );
      } else if (done) {
        const title = valueText(structured.title) || t('unknown');
        const artist = valueText(structured.artist);
        const confidence = typeof structured.confidence === 'number' ? structured.confidence : undefined;
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0 4px', minHeight: 0 } },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('div', { style: { fontSize: 18, fontWeight: 700, color: COLORS.label, lineHeight: 1.3, wordBreak: 'break-word' } }, title),
            artist
              ? h('div', { style: { fontSize: 13, color: COLORS.secondary } }, artist)
              : null,
            confidence !== undefined
              ? h('div', { style: { fontSize: 11, color: COLORS.success, marginTop: 2 } }, `${t('confidence')} ${Math.round(confidence * 100)}%`)
              : null,
          ),
          structured.summary
            ? h(
                'div',
                {
                  style: {
                    fontSize: 12,
                    color: COLORS.label,
                    lineHeight: 1.6,
                    background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
                    borderRadius: 8,
                    padding: '8px 10px',
                  },
                },
                valueText(structured.summary),
              )
            : null,
          h(FieldGrid, { structured, t }),
          state.body
            ? h(
                'details',
                { style: { marginTop: 2 } },
                h(
                  'summary',
                  { style: { cursor: 'pointer', fontSize: 12, color: COLORS.secondary, userSelect: 'none' } },
                  t('analysisTitle'),
                ),
                h(
                  'pre',
                  {
                    style: {
                      margin: '8px 0 0',
                      padding: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      font: 'inherit',
                      fontSize: 12,
                      lineHeight: 1.7,
                      color: COLORS.label,
                      maxHeight: 220,
                      overflow: 'auto',
                    },
                  },
                  state.body,
                ),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 2 } },
            state.meta
              ? h('span', { style: { marginRight: 'auto', fontSize: 11, color: COLORS.idle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, state.meta)
              : null,
            h(
              'button',
              {
                type: 'button',
                onClick: copy,
                style: {
                  border: `0.5px solid ${COLORS.border}`,
                  background: 'transparent',
                  color: COLORS.secondary,
                  borderRadius: 8,
                  padding: '7px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                },
              },
              copyState === 'copied' ? t('copied') : copyState === 'failed' ? t('copyFailed') : t('copy'),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: props.retry,
                style: {
                  border: 'none',
                  background: COLORS.brand,
                  color: 'var(--dsw-alias-bg-base, #ffffff)',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                },
              },
              t('retry'),
            ),
          ),
        );
      } else {
        body = null;
      }

      return h(
        React.Fragment,
        null,
        h('style', {
          key: 'song-id-style',
          dangerouslySetInnerHTML: {
            __html: '@keyframes songIdPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}',
          },
        }),
        h(
          'div',
          {
            key: 'song-id-panel',
            role: 'dialog',
            'aria-label': t('title'),
            style: {
              position: 'fixed',
              right: 24,
              bottom: 96,
              zIndex: 900,
              width: 'min(420px, calc(100vw - 32px))',
              maxHeight: 'min(72vh, 640px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '14px 16px 12px',
              borderRadius: 14,
              border: `0.5px solid ${COLORS.border}`,
              background: COLORS.card,
              boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
              pointerEvents: 'auto',
              color: COLORS.label,
              fontSize: 13,
              overflow: 'auto',
            },
          },
          header,
          body,
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'commandUi', 'remote', 'remote.commands'],
      apply,
    };
  },
});
