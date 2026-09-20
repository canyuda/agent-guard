// lib/log.mjs — JSONL 审计日志(spec §9;相对路径落数据目录)
import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import { resolvePaths } from "./paths.mjs";

export function appendAudit(entry, cfg) {
  if (!cfg.log.enabled) return;
  const line = { ts: new Date().toISOString(), tool: entry.tool,
    input_digest: String(entry.input_digest ?? "").slice(0, 200),
    source: entry.source, risk: entry.risk ?? null, risk_probabilities: entry.risk_probabilities ?? null,
    violation: entry.violation ?? null, level: entry.level, rendered: entry.rendered ?? null,
    reason: entry.reason, duration_ms: entry.duration_ms };
  const paths = resolvePaths();
  const p = isAbsolute(cfg.log.path) ? cfg.log.path : join(paths.dataDir, cfg.log.path);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(line) + "\n");
}
