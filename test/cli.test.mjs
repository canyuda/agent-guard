import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../lib/cli.mjs";
import { PKG_ROOT } from "../lib/paths.mjs";

const BIN = join(PKG_ROOT, "bin", "agent-guard.mjs");

test("parseArgs:version/help/setup flags/check 透传", () => {
  assert.equal(parseArgs(["--version"]).cmd, "version");
  assert.deepEqual(parseArgs([]), { cmd: "help", flags: {} });
  const s = parseArgs(["setup", "--key", "k", "--agents", "zcode,claude", "--scope", "project", "--dry-run", "--yes"]);
  assert.equal(s.cmd, "setup");
  assert.equal(s.flags.key, "k");
  assert.deepEqual(s.flags.agents, ["zcode", "claude"]);
  assert.equal(s.flags.scope, "project");
  assert.equal(s.flags.dryRun, true);
  assert.equal(s.flags.yes, true);
  const c = parseArgs(["check", "--mock", "--cmd", "git status"]);
  assert.equal(c.cmd, "check");
  assert.deepEqual(c.flags._, ["--mock", "--cmd", "git status"]);
});

test("无参数 → usage 且退出码 1", () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /usage|用法/i);
});

test("check 子命令经 bin 冒烟(mock)", () => {
  const r = spawnSync(process.execPath, [BIN, "check", "--mock", "--cmd", "git reset --hard HEAD~1"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /level=confirm/);
});

test("hook 子命令经 bin(管道 stdin,注入 mock)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const cfgPath = join(dir, "c.json");
  writeFileSync(cfgPath, JSON.stringify({ degrade_ask_to_deny: true, log: { enabled: true, path: join(dir, "a.jsonl") }, cache: { path: join(dir, "cache.json") } }));
  const r = spawnSync(process.execPath, [BIN, "hook"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "docker compose down" } }),
    encoding: "utf8",
    env: { ...process.env, AGENT_GUARD_CONFIG: cfgPath, AGENT_GUARD_MOCK_JSON: JSON.stringify({ risk: 2.0, violation: 0.1 }) },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});
