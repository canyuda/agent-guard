// lib/fastpath.mjs — 名单快路径与判定缓存(spec §6)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function cacheKey(toolName, toolInput) {
  let payload;
  if (toolName === "Bash") payload = `Bash:${String(toolInput.command ?? "").trim()}`;
  else if (toolInput.file_path != null || toolInput.path != null)
    payload = `${toolName}:${toolInput.file_path ?? toolInput.path}:${String(toolInput.content ?? toolInput.new_string ?? "")}`;
  else payload = `${toolName}:${JSON.stringify(toolInput, Object.keys(toolInput ?? {}).sort())}`;
  return createHash("sha1").update(payload).digest("hex");
}

export function matchFast(toolName, toolInput, cfg) {
  if (toolName.startsWith("mcp__")) {
    const server = toolName.split("__")[1] ?? "";
    return cfg.fastpath.mcp_allowlist.includes(server)
      ? { hit: true, level: "allow", source: "fastpath_mcp" } : { hit: false };
  }
  const cmd = String(toolInput?.command ?? "");
  if (toolName !== "Bash" || cmd === "") return { hit: false };
  for (const re of cfg.fastpath.allowlist) if (new RegExp(re).test(cmd)) return { hit: true, level: "allow", source: "fastpath_allow" };
  for (const re of cfg.fastpath.denylist) if (new RegExp(re).test(cmd)) return { hit: true, level: "block", source: "fastpath_block" };
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
