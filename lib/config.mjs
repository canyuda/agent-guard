// lib/config.mjs — 配置加载与 API key 解析(spec §7;数据目录见 paths.mjs)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePaths, ensureUserConfig } from "./paths.mjs";

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  model: "jev-latest",
  degrade_ask_to_deny: true,
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

export function loadConfig(path) {
  const paths = resolvePaths();
  if (path === undefined) ensureUserConfig(paths); // 仅默认路径才做首启复制
  const p = path ?? paths.configPath;
  try {
    return deepMerge(DEFAULTS, JSON.parse(readFileSync(p, "utf8")));
  } catch {
    return { ...DEFAULTS }; // 文件缺失/损坏:用默认值,不静默崩溃(兜底语义 spec §8)
  }
}

export function readRc(rcPath) {
  try {
    const m = readFileSync(rcPath, "utf8").match(/^TYPESAFE_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1];
  } catch { /* 无 rc 文件 */ }
  return null;
}

export function resolveApiKey(env = process.env, rcPath = join(homedir(), ".agentguardrc")) {
  if (env.TYPESAFE_API_KEY) return String(env.TYPESAFE_API_KEY);
  return readRc(rcPath);
}
