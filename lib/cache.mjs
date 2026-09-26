// lib/cache.mjs — 判定缓存 deep module:键构造、TTL/LRU、路径解析、fs 全部收进 implementation
// interface: judgmentCache(cfg) → { lookup(toolName, toolInput, now?), store(toolName, toolInput, judgments, now?) }
// 不变量:存原始判定概率(risk/violation),阈值由 decide 现算——改阈值即时生效、无需清缓存(spec §6)
// store 尽力而为:磁盘失败只告警不抛,绝不影响判定路径(与审计失败同策略);cfg.cache.path 可将缓存指到自定义位置
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { resolvePaths } from "./paths.mjs";
import { toolIdentity } from "./identity.mjs";

function cacheKey(toolName, toolInput) {
  const id = toolIdentity(toolName, toolInput);
  const payload = id.kind === "bash" ? `Bash:${id.command.trim()}` // 归一化仅去首尾空白(spec §6)
    : id.kind === "file" ? `${toolName}:${id.filePath}:${id.content}`
    : `${toolName}:${id.args}`;
  return createHash("sha1").update(payload).digest("hex");
}

function loadCache(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } }

export function judgmentCache(cfg) {
  const custom = cfg.cache?.path;
  const path = custom ? (isAbsolute(custom) ? custom : join(resolvePaths().dataDir, custom)) : resolvePaths().cachePath;
  return {
    lookup(toolName, toolInput, now = Date.now()) {
      const e = loadCache(path)[cacheKey(toolName, toolInput)];
      if (!e || typeof e.expires !== "number" || now > e.expires) return null;
      return { risk: e.risk, violation: e.violation };
    },
    store(toolName, toolInput, judgments, now = Date.now()) {
      try {
        const entries = loadCache(path);
        entries[cacheKey(toolName, toolInput)] = { risk: judgments.risk, violation: judgments.violation, expires: now + cfg.cache.ttl_minutes * 60_000 };
        const keys = Object.keys(entries).sort((a, b) => (entries[a].expires ?? 0) - (entries[b].expires ?? 0));
        for (const k of keys.slice(0, Math.max(0, keys.length - cfg.cache.max_entries))) delete entries[k];
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(entries));
      } catch (e) {
        console.error(`agent-guard: 判定缓存写入失败(${e?.message ?? e}),本次跳过缓存`);
      }
    },
  };
}
