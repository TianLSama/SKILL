/**
 * Client 端配置页的最小冒烟测试：
 *   - 用假的 __ModuleLoader__ / require / ctx 加载 client.js；
 *   - 确认注册到 plugins.row.config，key 与 bundle 行一致；
 *   - 确认 inject 提供表单 store 与 actions，组件能渲染 summary/page。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '..', 'client.js'), 'utf8');

let loaded;
const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec;
    },
  },
};

vm.runInNewContext(source, { window: fakeWindow, console, setTimeout, clearTimeout });
assert.ok(loaded, 'client.js 应调用 __ModuleLoader__.load');
assert.equal(loaded.id, '@local/qwen-omni-bridge');

class FakeSettingsFormModel {
  constructor(scope, specs, secrets) {
    this.scope = scope;
    this.specs = new Map(specs.map((spec) => [spec.field, spec]));
    this.secrets = secrets ?? [];
  }
  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false };
  }
  field(field) {
    return { text: field === 'reasoningEffort' ? 'low' : '', overridden: false, invalid: false };
  }
  bind(project) {
    const store = { getSnapshot: project, subscribe: () => () => {} };
    return store;
  }
  actions() {
    return { edit() {}, resetField() {}, save() {}, discard() {} };
  }
  dispose() {}
}

const stub = (name) => (props) => ({ type: name, props });
const fakeRequire = (id) => {
  if (id === 'react') {
    return {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
    };
  }
  if (id === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      SettingsForm: stub('SettingsForm'),
      SettingsSecretField: stub('SettingsSecretField'),
      SettingsValueField: stub('SettingsValueField'),
      SettingsFormModel: FakeSettingsFormModel,
      settingsTextField: (field) => ({
        field,
        format: (value) => (typeof value === 'string' ? value : ''),
        parse: (text) => (text.trim() ? { kind: 'set', value: text.trim() } : { kind: 'clear' }),
      }),
    };
  }
  throw new Error(`unexpected require: ${id}`);
};

const mod = loaded.factory(fakeRequire);
assert.equal(mod.inject.join(','), 'slots,locale,configForms');

const scope = {
  getSnapshot: () => ({
    status: 'ready',
    writable: true,
    revision: 1,
    value: {
      baseURL: 'https://example.test/compatible-mode/v1',
      model: 'qwen3.8-omni-flash',
      reasoningEffort: 'low',
      autoAnalyzeAttachments: true,
      allowOutsideWorkspace: false,
      debug: false,
    },
    base: {},
    user: {},
  }),
  subscribe: () => () => {},
  mutate: async () => true,
};
const mirror = {
  getSnapshot: () => ({
    view: {
      writable: true,
      namespaces: [
        {
          ns: 'qwen-omni-bridge',
          secrets: [{ path: ['apiKey'], set: true }],
        },
      ],
    },
  }),
  subscribe: () => () => {},
};

const registered = [];
const disposers = [];
const ctx = {
  locale: {
    bind: () => (key) => key,
    register: () => () => {},
  },
  configForms: {
    get: (id) => {
      assert.equal(id, 'qwen-omni-bridge');
      return scope;
    },
    describe: () => mirror,
    whileServed: (names, register) => {
      assert.equal(names.join(','), 'qwen-omni-bridge');
      return register(new Set(names));
    },
  },
  slots: {
    inject: (_name, register) => register(),
    register: (definition, component) => {
      registered.push({ definition, component });
      return () => {};
    },
  },
  effect: (fn) => {
    const dispose = fn();
    if (typeof dispose === 'function') disposers.push(dispose);
    return dispose;
  },
};

mod.apply(ctx);
assert.equal(registered.length, 1, '应注册一个 plugins.row.config 条目');
const { definition, component } = registered[0];
assert.equal(definition.name, 'plugins.row.config');
assert.equal(definition.key, '@local/qwen-omni-bridge#qwen-omni-bridge');
assert.equal(definition.locale, 'settings.qwenOmni');

const injected = definition.inject();
assert.ok(injected.hooks?.qwenOmniForm, '应注入 qwenOmniForm store');
assert.equal(typeof injected.edit, 'function');
assert.equal(typeof injected.save, 'function');
assert.equal(typeof injected.clearApiKey, 'function');
const snapshot = injected.hooks.qwenOmniForm.getSnapshot();
assert.equal(snapshot.baseURL.text, '');
assert.equal(snapshot.reasoningEffort.text, 'low');

const summary = component({
  t: (key) => key,
  view: 'summary',
  useQwenOmniForm: (select) => select(snapshot),
  ...injected,
});
assert.equal(summary, 'summary');

const page = component({
  t: (key) => key,
  view: 'page',
  useQwenOmniForm: (select) => select(snapshot),
  ...injected,
});
assert.ok(page.props, 'page view 应渲染 SettingsForm');
assert.ok(page.props.labels, 'SettingsForm 应收到 labels');
assert.ok(page.props.children.length >= 3, '应包含多个字段');

console.log('client smoke OK: plugins.row.config @local/qwen-omni-bridge#qwen-omni-bridge');
