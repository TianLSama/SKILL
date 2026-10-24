/**
 * API Key 解析。
 *
 * 优先级：
 *   1. 插件管理页面填写的 API Key（config.apiKey，非空时使用）；
 *   2. 当前进程环境变量（默认 ALIYUN_API_KEY，其次 DASHSCOPE_API_KEY）；
 *   3. Windows 用户环境变量（HKCU\Environment）。有些部署会在 DSH 启动后
 *      才设置用户变量，此时进程环境里没有，但注册表里已经有了。
 *
 * 只返回密钥本身和来源标签，绝不把密钥写入日志或工具输出。
 */
import { execFileSync } from 'node:child_process';

const cache = new Map();

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从 HKCU\Environment 读取一个用户环境变量；非 Windows 或不存在时返回 undefined。 */
function readWindowsUserEnv(name) {
  if (process.platform !== 'win32') return undefined;
  if (cache.has(name)) return cache.get(name);
  let value;
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    const pattern = new RegExp(`^\\s*${escapeRegExp(name)}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+)$`, 'mi');
    const match = output.match(pattern);
    value = match?.[1]?.trim() || undefined;
  } catch {
    value = undefined;
  }
  cache.set(name, value);
  return value;
}

/**
 * 解析 API Key：页面配置优先；留空时读取环境变量。
 * @param {string | undefined} literal 插件管理页面填写的 Key
 * @param {readonly string[]} names 环境变量名列表，按顺序尝试
 * @returns {{ value: string, source: string } | undefined}
 */
export function resolveApiKey(literal, names) {
  if (typeof literal === 'string' && literal.trim()) {
    return { value: literal.trim(), source: 'config.plugin-page' };
  }
  const list = Array.isArray(names) && names.length > 0 ? names : ['ALIYUN_API_KEY', 'DASHSCOPE_API_KEY'];
  for (const name of list) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
      return { value: value.trim(), source: `env:${name}` };
    }
  }
  for (const name of list) {
    const value = readWindowsUserEnv(name);
    if (value) return { value, source: `HKCU\\Environment:${name}` };
  }
  return undefined;
}

/** 测试用：清空注册表读取缓存。 */
export function clearApiKeyCache() {
  cache.clear();
}
