import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localIsoTs, appendAudit, appendError } from "../lib/log.mjs";

test("localIsoTs:ISO 格式带本地时区偏移,且与输入同一时刻", () => {
  const input = new Date("2026-09-26T06:00:00.123Z");
  const ts = localIsoTs(input);
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  const m = ts.match(/([+-])(\d{2}):(\d{2})$/);
  const offMin = (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]));
  assert.equal(Date.parse(ts.slice(0, 23) + "Z") - offMin * 60_000, input.getTime());
});

test("appendAudit:log.enabled=false 不写盘", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-log-"));
  const p = join(dir, "a.jsonl");
  appendAudit({ tool: "Bash", source: "api", level: "allow", reason: "x" }, { log: { enabled: false, path: p } });
  assert.equal(existsSync(p), false);
  rmSync(dir, { recursive: true, force: true });
});

test("appendAudit:字段归一化——digest 截 200、缺省字段补 null、ts 带偏移", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-log-"));
  const p = join(dir, "a.jsonl");
  appendAudit({ tool: "Bash", input_digest: "x".repeat(300), source: "api", level: "allow", reason: "r" },
    { log: { enabled: true, path: p } });
  const line = JSON.parse(readFileSync(p, "utf8").trim());
  assert.equal(line.input_digest.length, 200);
  assert.equal(line.risk, null);
  assert.equal(line.violation, null);
  assert.equal(line.rendered, null);
  assert.match(line.ts, /[+-]\d{2}:\d{2}$/);
  assert.equal(line.duration_ms, undefined);
  rmSync(dir, { recursive: true, force: true });
});

test("appendError:写 audit 同目录 error.jsonl;enabled=false 不写", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-log-"));
  appendError({ tool: "Bash", error_type: "timeout", request: null },
    { log: { enabled: false, path: join(dir, "a.jsonl") } });
  assert.equal(existsSync(join(dir, "error.jsonl")), false);
  appendError({ tool: "Bash", error_type: "timeout", request: { url: "u", headers: {}, body: "b" } },
    { log: { enabled: true, path: join(dir, "sub", "a.jsonl") } });
  const line = JSON.parse(readFileSync(join(dir, "sub", "error.jsonl"), "utf8").trim());
  assert.equal(line.error_type, "timeout");
  assert.equal(line.request.url, "u");
  assert.match(line.ts, /[+-]\d{2}:\d{2}$/);
  rmSync(dir, { recursive: true, force: true });
});
