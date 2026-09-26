// lib/fastpath.mjs — 名单快路径与判定缓存(spec §6);身份字段取自 identity.mjs(单一来源)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { toolIdentity } from "./identity.mjs";

export function cacheKey(toolName, toolInput) {
  const id = toolIdentity(toolName, toolInput);
  const payload = id.kind === "bash" ? `Bash:${id.command.trim()}` // 归一化仅去首尾空白(spec §6)
    : id.kind === "file" ? `${toolName}:${id.filePath}:${id.content}`
    : `${toolName}:${id.args}`;
  return createHash("sha1").update(payload).digest("hex");
}

export function matchFast(toolName, toolInput, cfg) {
  const id = toolIdentity(toolName, toolInput);
  if (id.kind === "mcp")
    return cfg.fastpath.mcp_allowlist.includes(id.server)
      ? { hit: true, level: "allow", source: "fastpath_mcp" } : { hit: false };
  if (id.kind !== "bash" || id.command === "") return { hit: false };
  for (const re of cfg.fastpath.allowlist) if (new RegExp(re).test(id.command)) return { hit: true, level: "allow", source: "fastpath_allow" };
  for (const re of cfg.fastpath.denylist) if (new RegExp(re).test(id.command)) return { hit: true, level: "block", source: "fastpath_block" };
  return { hit: false };
}

function loadCache(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } }

export function cacheLookup(cachePath, key, now = Date.now()) {
  const e = loadCache(cachePath)[key];
  if (!e || typeof e.expires !== "number" || now > e.expires) return null;
  return { risk: e.risk, violation: e.violation };
}

export function cacheStore(cachePath, key, judgments, cfg, now = Date.now()) {
  const entries = loadCache(cachePath);
  entries[key] = { risk: judgments.risk, violation: judgments.violation, expires: now + cfg.cache.ttl_minutes * 60_000 };
  const keys = Object.keys(entries).sort((a, b) => (entries[a].expires ?? 0) - (entries[b].expires ?? 0));
  for (const k of keys.slice(0, Math.max(0, keys.length - cfg.cache.max_entries))) delete entries[k];
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(entries));
}
