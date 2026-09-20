// lib/judge.mjs — 编排:state→快路径→缓存→API→三级判定(spec §3)
import { join } from "node:path";
import { buildState } from "./state.mjs";
import { matchFast, cacheKey, cacheLookup, cacheStore } from "./fastpath.mjs";
import { decide } from "./decide.mjs";
import { askTypeSafe } from "./typesafe.mjs";
import { resolvePaths } from "./paths.mjs";

export async function judge(toolName, toolInput, cfg, deps = {}) {
  const start = Date.now();
  const ask = deps.ask ?? askTypeSafe;
  const cachePath = cfg.__cachePath ?? resolvePaths().cachePath;
  const state = buildState(toolName, toolInput, cfg);

  const fp = matchFast(toolName, toolInput, cfg);
  if (fp.hit) {
    const reason = fp.level === "allow" ? "只读白名单/豁免命中" : "黑名单命中:明确破坏性命令";
    return { level: fp.level, reason, source: fp.source, judgments: null, duration_ms: Date.now() - start, state };
  }
  const key = cacheKey(toolName, toolInput);
  const cached = cacheLookup(cachePath, key);
  if (cached) { // 缓存存原始判定,阈值现算(spec §6)
    const d = decide(cached, cfg);
    return { ...d, source: "cache", judgments: cached, duration_ms: Date.now() - start, state };
  }
  try {
    const judgments = await ask(state, cfg);
    cacheStore(cachePath, key, judgments, cfg);
    const d = decide(judgments, cfg);
    return { ...d, source: "api", judgments, duration_ms: Date.now() - start, state };
  } catch (e) { // fail-closed:评估不可用一律转人工(spec §8)
    return { level: "confirm", reason: `评估服务不可用(${e?.type ?? "unknown"}),按 fail-closed 转人工`,
      source: "error", judgments: null, duration_ms: Date.now() - start, state };
  }
}
