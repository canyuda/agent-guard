import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT, loadConfig } from "../lib/config.mjs";

const runHook = (stdinText, env) => spawnSync(process.execPath, [join(PROJECT_ROOT, "hook.mjs")],
  { input: stdinText, encoding: "utf8", env: { ...process.env, ...env } });

const BASE_CFG = loadConfig(join(PROJECT_ROOT, "config.json")); // 名单用真实初值
const testEnv = (mock) => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const cfgPath = join(dir, "c.json");
  writeFileSync(cfgPath, JSON.stringify({ ...BASE_CFG, degrade_ask_to_deny: true, log: { enabled: true, path: join(dir, "a.jsonl") }, __cachePath: join(dir, "cache.json") }));
  return { dir, env: { AGENT_GUARD_CONFIG: cfgPath, AGENT_GUARD_MOCK_JSON: JSON.stringify(mock) } };
};

const INPUT = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "docker compose down", cwd: "/x" } });

test("confirm 样例(mock risk=2.0)→ degrade 渲染 deny,退出码 0,写审计", () => {
  const { dir, env } = testEnv({ risk: 2.0, violation: 0.1 });
  const r = runHook(INPUT, env);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, "deny");
  assert.match(out.permissionDecisionReason, /需人工确认/);
  const audit = readFileSync(join(dir, "a.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(audit.at(-1).level, "confirm");
  assert.equal(audit.at(-1).rendered, "deny");
  rmSync(dir, { recursive: true, force: true });
});

test("白名单命令 → allow,退出码 0", () => {
  const { dir, env } = testEnv({ risk: 9, violation: 9 });
  const r = runHook(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" } }), env);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("stdin 非法 JSON → 渲染 confirm(内部错误),仍退出 0", () => {
  const { dir, env } = testEnv({ risk: 0, violation: 0 });
  const r = runHook("not-json{{", env);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  rmSync(dir, { recursive: true, force: true });
});
