/**
 * Qwen 全模态桥接的浏览器端配置页。
 *
 * 只注册插件管理页 `plugins.row.config` 的一个条目，键与 bundle 行一致：
 *   @local/qwen-omni-bridge#qwen-omni-bridge
 * Host 端 Config schema 负责校验与持久化；这里用共享的 SettingsForm 渲染表单。
 */
window.__ModuleLoader__.load({
  id: '@local/qwen-omni-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {
      SettingsForm,
      SettingsFormModel,
      SettingsSecretField,
      SettingsValueField,
      settingsTextField,
    } = require('@deepseek-ai/dsh-client-ui-primitives');

    const NS = 'settings.qwenOmni';
    // settings.describe() 的 ns 是 bundle patch 行的 id，不是 Loader 的 include: 条目 id。
    const ENTRY_ID = 'qwen-omni-bridge';
    const ROW_KEY = '@local/qwen-omni-bridge#qwen-omni-bridge';

    const zh = {
      summary: '配置接入点、API Key、模型和自动解析选项。',
      policyTitle: '音视频理解策略：omni-only',
      policyText: '所有音频、视频内容（含画面、人物动作、屏幕文字、公式、图表、曲线）均由 qwen3.8-omni-flash 解析；主模型只负责调度、拆分问题和整合结果，不使用抽帧/截图读图替代视频理解。',
      baseURL: '接入点',
      baseURLHint: 'OpenAI 兼容接口根地址，通常以 /compatible-mode/v1 结尾；留空时读取环境变量 ALIYUN_BASE_URL。',
      apiKey: 'API Key',
      apiKeyHint: '留空则读取环境变量 ALIYUN_API_KEY（其次 DASHSCOPE_API_KEY）。已配置时留空保持不变。',
      configured: '已配置',
      notConfigured: '未配置',
      clearKey: '清除页面 Key',
      model: '模型',
      modelHint: '默认 qwen3.8-omni-flash。',
      effort: '思考强度',
      effortHint: 'none 最快，low 默认，medium/xhigh 更深入但更慢。',
      autoAnalyze: '自动解析附件',
      autoAnalyzeHint: '上传音视频时自动调用全模态模型解析。',
      allowOutside: '允许工作区外路径',
      allowOutsideHint: '允许 omni_media 读取工作区和 DSH 附件目录之外的路径。',
      debug: '调试日志',
      debugHint: '输出调试日志，不包含 API Key。',
      overridden: '已覆盖',
      reset: '恢复默认',
      invalid: '值无效',
      save: '保存',
      saving: '保存中…',
      saveFailed: '保存失败，请检查输入。',
      readOnly: '当前部署的设置为只读。',
      unavailable: '插件未加载，暂时无法配置。',
    };

    const en = {
      summary: 'Configure the endpoint, API key, model, and auto-analysis options.',
      policyTitle: 'Audio/video policy: omni-only',
      policyText: 'All audio and video content (frames, actions, on-screen text, formulas, charts, curves) is analyzed by qwen3.8-omni-flash. The main model only dispatches, splits questions, and integrates results; it must not substitute frame extraction or screenshot OCR for video understanding.',
      baseURL: 'Endpoint',
      baseURLHint: 'OpenAI-compatible base URL, usually ending in /compatible-mode/v1; falls back to ALIYUN_BASE_URL when blank.',
      apiKey: 'API key',
      apiKeyHint: 'Leave blank to use ALIYUN_API_KEY (then DASHSCOPE_API_KEY). A configured key is kept when this is blank.',
      configured: 'Configured',
      notConfigured: 'Not configured',
      clearKey: 'Clear page key',
      model: 'Model',
      modelHint: 'Defaults to qwen3.8-omni-flash.',
      effort: 'Reasoning effort',
      effortHint: 'none is fastest; low is the default; medium/xhigh are deeper but slower.',
      autoAnalyze: 'Auto-analyze attachments',
      autoAnalyzeHint: 'Analyze uploaded audio/video automatically.',
      allowOutside: 'Allow paths outside the workspace',
      allowOutsideHint: 'Allow omni_media to read paths outside the workspace and DSH attachment directory.',
      debug: 'Debug logging',
      debugHint: 'Log debug details without API keys.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      invalid: 'Invalid value',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'Save failed; check the values and try again.',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
    };

    /** 布尔字段：SettingsFormModel 的 draft 是字符串，true/false 映射到复选框。 */
    function boolField(field) {
      return {
        field,
        format: (value) => (value === true ? 'true' : 'false'),
        parse: (text) => ({ kind: 'set', value: text === 'true' }),
      };
    }

    /** 枚举/自由文本字段：空文本清除，非空写回。 */
    function choiceField(field) {
      return {
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => {
          const trimmed = text.trim();
          return trimmed ? { kind: 'set', value: trimmed } : { kind: 'clear' };
        },
      };
    }

    function fieldProps(t, field, id, fieldName, label, hint, writable, actions) {
      return {
        id,
        label,
        hint,
        text: field.text,
        overridden: field.overridden,
        invalid: field.invalid,
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        invalidLabel: t('invalid'),
        disabled: !writable,
        onEdit: (value) => actions.edit(fieldName, value),
        onReset: () => actions.resetField(fieldName),
      };
    }

    function ToggleRow({ t, id, label, hint, field, writable, onEdit }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('label', {
          htmlFor: id,
          style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-primary)' },
        },
          h('input', {
            id,
            type: 'checkbox',
            checked: field.text === 'true',
            disabled: !writable,
            onChange: (event) => onEdit(event.target.checked ? 'true' : 'false'),
          }),
          h('span', null, label),
        ),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, hint),
      );
    }

    function SelectRow({ t, id, label, hint, field, writable, onEdit, options }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('label', { htmlFor: id, style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, label),
        h('select', {
          id,
          value: options.some((option) => option.value === field.text) ? field.text : options[0].value,
          disabled: !writable,
          onChange: (event) => onEdit(event.target.value),
          style: {
            width: '100%',
            height: 32,
            borderRadius: 6,
            border: '0.5px solid var(--dsw-alias-border-l4)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            padding: '0 8px',
          },
        }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
        h('p', { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, hint),
      );
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qwen-omni: dictionaries');

      const scope = ctx.configForms.get(ENTRY_ID);
      const model = new SettingsFormModel(
        scope,
        [
          settingsTextField('baseURL'),
          settingsTextField('model'),
          choiceField('reasoningEffort'),
          boolField('autoAnalyzeAttachments'),
          boolField('allowOutsideWorkspace'),
          boolField('debug'),
        ],
        [{
          field: 'apiKey',
          write: (text) => scope.mutate(
            [{ op: 'set', path: ['apiKey'], value: text }],
            scope.getSnapshot().revision,
          ),
        }],
      );
      const store = model.bind(() => ({
        ...model.shell(),
        baseURL: model.field('baseURL'),
        apiKey: model.field('apiKey'),
        model: model.field('model'),
        reasoningEffort: model.field('reasoningEffort'),
        autoAnalyzeAttachments: model.field('autoAnalyzeAttachments'),
        allowOutsideWorkspace: model.field('allowOutsideWorkspace'),
        debug: model.field('debug'),
      }));
      ctx.effect(() => () => model.dispose(), 'qwen-omni: form subscription');

      const describe = ctx.configForms.describe();
      const readConfigured = () => {
        const view = describe.getSnapshot().view;
        const entry = view?.namespaces.find((item) => item.ns === ENTRY_ID);
        return entry?.secrets?.some(
          (secret) => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set,
        ) ?? false;
      };

      function useConfigured() {
        const [configured, setConfigured] = React.useState(readConfigured);
        React.useEffect(() => describe.subscribe(() => setConfigured(readConfigured())), []);
        return configured;
      }

      function RowConfigForm(props) {
        const t = props.t;
        const state = props.useQwenOmniForm((snapshot) => snapshot);
        const configured = useConfigured();
        if (props.view === 'summary') return t('summary');

        return h(SettingsForm, {
          labels: {
            unavailable: t('unavailable'),
            readOnly: t('readOnly'),
            saveFailed: t('saveFailed'),
            save: t('save'),
            saving: t('saving'),
          },
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
          h('div', {
            style: {
              border: '0.5px solid var(--dsw-alias-border-l3)',
              borderRadius: 8,
              background: 'var(--dsw-alias-bg-layer-1)',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            },
          },
            h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('policyTitle')),
            h('p', {
              style: {
                margin: 0,
                fontSize: 12,
                lineHeight: 1.5,
                color: 'var(--dsw-alias-label-secondary)',
              },
            }, t('policyText')),
          ),
          h(SettingsValueField, fieldProps(t, state.baseURL, 'qwen-omni-base-url', 'baseURL', t('baseURL'), t('baseURLHint'), state.writable, props)),
          h(SettingsSecretField, {
            id: 'qwen-omni-api-key',
            label: t('apiKey'),
            hint: t('apiKeyHint'),
            text: state.apiKey.text,
            disabled: !state.writable,
            configured,
            stateLabel: configured ? t('configured') : t('notConfigured'),
            onEdit: (value) => props.edit('apiKey', value),
          }),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            h('button', {
              type: 'button',
              disabled: !state.writable || !configured,
              onClick: () => props.clearApiKey(),
              style: {
                border: '0.5px solid var(--dsw-alias-border-l3)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                font: 'inherit',
                fontSize: 12,
                padding: '4px 10px',
                cursor: !state.writable || !configured ? 'not-allowed' : 'pointer',
              },
            }, t('clearKey')),
          ),
          h(SettingsValueField, fieldProps(t, state.model, 'qwen-omni-model', 'model', t('model'), t('modelHint'), state.writable, props)),
          h(SelectRow, {
            t,
            id: 'qwen-omni-effort',
            label: t('effort'),
            hint: t('effortHint'),
            field: state.reasoningEffort,
            writable: state.writable,
            onEdit: (value) => props.edit('reasoningEffort', value),
            options: [
              { value: 'none', label: 'none' },
              { value: 'low', label: 'low' },
              { value: 'medium', label: 'medium' },
              { value: 'xhigh', label: 'xhigh' },
            ],
          }),
          h(ToggleRow, {
            t,
            id: 'qwen-omni-auto-analyze',
            label: t('autoAnalyze'),
            hint: t('autoAnalyzeHint'),
            field: state.autoAnalyzeAttachments,
            writable: state.writable,
            onEdit: (value) => props.edit('autoAnalyzeAttachments', value),
          }),
          h(ToggleRow, {
            t,
            id: 'qwen-omni-allow-outside',
            label: t('allowOutside'),
            hint: t('allowOutsideHint'),
            field: state.allowOutsideWorkspace,
            writable: state.writable,
            onEdit: (value) => props.edit('allowOutsideWorkspace', value),
          }),
          h(ToggleRow, {
            t,
            id: 'qwen-omni-debug',
            label: t('debug'),
            hint: t('debugHint'),
            field: state.debug,
            writable: state.writable,
            onEdit: (value) => props.edit('debug', value),
          }),
        );
      }

      ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: ROW_KEY,
        locale: NS,
        inject: () => ({
          hooks: { qwenOmniForm: store },
          ...model.actions(),
          clearApiKey: () => {
            void scope.mutate([{ op: 'unset', path: ['apiKey'] }]);
          },
        }),
      }, RowConfigForm))), 'qwen-omni: row config page');
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply,
    };
  },
});
