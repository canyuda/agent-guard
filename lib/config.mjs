// lib/config.mjs — 配置加载与 API key 解析(spec §7;文件位置与首启复制见 paths.mjs)
// 模板与 DEFAULTS 的一致性由 config.test.mjs 防漂移断言锚定(degrade 默认值决策见 docs/adr/0001)
import { readFileSync, existsSync } from "node:fs";
import { resolvePaths } from "./paths.mjs";

export const DEFAULTS = {
  model: "jev-latest",
  degrade_ask_to_deny: false, // ADR 0001:confirm 用 ask 承载,守卫只拦高危,保住完全访问体验
  thresholds: { block_risk: 2.5, block_violation: 0.85, confirm_risk: 1.5, confirm_violation: 0.5 },
  fastpath: { mcp_allowlist: [], allowlist: [], denylist: [] },
  cache: { ttl_minutes: 60, max_entries: 500 },
  log: { enabled: true, path: "logs/audit.jsonl" },
  state: { content_prefix_bytes: 2048 },
  proxy: { enabled: false, host: "", port: 0 }, // 代理默认关;模板示例 127.0.0.1:7890 见 config.json
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over ?? {})) {
    out[k] = over[k] && typeof over[k] === "object" && !Array.isArray(over[k])
      && typeof base[k] === "object" && !Array.isArray(base[k])
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

// 纯读+合并:不做任何写操作(首启复制由入口显式调 ensureUserConfig)
export function loadConfig(path) {
  const p = path ?? resolvePaths().configPath;
  let user = {};
  try {
    user = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    if (existsSync(p)) console.error(`agent-guard: 配置文件损坏,本次用内置默认(${p})`); // 不覆盖用户文件
    return deepMerge(DEFAULTS, {});
  }
  return deepMerge(DEFAULTS, user);
}

export function readRc(rcPath) {
  try {
    const m = readFileSync(rcPath, "utf8").match(/^TYPESAFE_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  } catch { /* 无 rc 文件 */ }
  return null;
}

export function resolveApiKey(env = process.env, rcPath = resolvePaths().rcPath) {
  if (env.TYPESAFE_API_KEY) return String(env.TYPESAFE_API_KEY);
  return readRc(rcPath);
}
