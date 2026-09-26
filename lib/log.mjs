// lib/log.mjs — JSONL 审计日志(spec §9;相对路径落数据目录)
import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import { resolvePaths } from "./paths.mjs";

// ts 用本地时间+时区偏移(如 2026-09-24T14:43:01.124+08:00),直读无时差且保持 ISO 可排序
export function localIsoTs(now = new Date()) {
  const off = now.getTimezoneOffset(); // getTimezoneOffset 是 UTC-本地,东八区为 -480
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const shifted = new Date(now.getTime() - off * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${shifted.toISOString().slice(0, 23)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function appendAudit(entry, cfg) {
  if (!cfg.log.enabled) return;
  const line = { ts: localIsoTs(), tool: entry.tool,
    input_digest: String(entry.input_digest ?? "").slice(0, 200),
    source: entry.source, risk: entry.risk ?? null, risk_probabilities: entry.risk_probabilities ?? null,
    violation: entry.violation ?? null, level: entry.level, rendered: entry.rendered ?? null,
    reason: entry.reason, duration_ms: entry.duration_ms };
  const paths = resolvePaths();
  const p = isAbsolute(cfg.log.path) ? cfg.log.path : join(paths.dataDir, cfg.log.path);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(line) + "\n");
}
