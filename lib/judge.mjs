// lib/judge.mjs — 编排:state→快路径→缓存→API→三级判定(spec §3)
import { buildState } from "./state.mjs";
import { matchFast } from "./fastpath.mjs";
import { judgmentCache } from "./cache.mjs";
import { decide } from "./decide.mjs";
import { askTypeSafe } from "./typesafe.mjs";

export async function judge(toolName, toolInput, cfg, deps = {}) {
  const start = Date.now();
  const ask = deps.ask ?? askTypeSafe;
  const cache = judgmentCache(cfg);
  const state = buildState(toolName, toolInput, cfg);

  const fp = matchFast(toolName, toolInput, cfg);
  if (fp.hit) {
    const reason = fp.level === "allow" ? "只读白名单/豁免命中" : "黑名单命中:明确破坏性命令";
    return { level: fp.level, reason, source: fp.source, judgments: null, duration_ms: Date.now() - start, state };
  }
  const cached = cache.lookup(toolName, toolInput);
  if (cached) { // 缓存存原始判定,阈值现算(spec §6)
    const d = decide(cached, cfg);
    return { ...d, source: "cache", judgments: cached, duration_ms: Date.now() - start, state };
  }
  try {
    const judgments = await ask(state, cfg);
    cache.store(toolName, toolInput, judgments); // 尽力而为:写失败已在 cache 内告警,不影响判定
    const d = decide(judgments, cfg);
    return { ...d, source: "api", judgments, duration_ms: Date.now() - start, state };
  } catch (e) { // fail-closed:评估不可用一律转人工(spec §8);缓存写失败不会落到这里
    return { level: "confirm", reason: `评估服务不可用(${e?.type ?? "unknown"}),按 fail-closed 转人工`,
      source: "error", judgments: null, duration_ms: Date.now() - start, state };
  }
}
