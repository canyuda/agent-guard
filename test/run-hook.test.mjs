import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { PROJECT_ROOT, loadConfig } from "../lib/config.mjs";
import { pipeline, main } from "../lib/run-hook.mjs";

const baseCfg = () => loadConfig(join(PROJECT_ROOT, "config.json"));
const whitelistInput = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" } });

test("pipeline:白名单命令 → allow,审计 rendered 与实际输出同源", async () => {
  const r = await pipeline(whitelistInput, baseCfg(), { ask: async () => { throw new Error("白名单命中不应触网"); } });
  assert.equal(r.exitCode, undefined);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "allow");
  assert.equal(r.auditEntry.source, "fastpath_allow");
  assert.equal(r.auditEntry.rendered, "allow");
});

test("pipeline:兜底跟随 degrade,审计 rendered=实际 decision(修复恒为 deny 的失真)", async () => {
  const r1 = await pipeline("not-json{{", { ...baseCfg(), degrade_ask_to_deny: true }, {});
  assert.equal(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(r1.auditEntry.rendered, "deny");

  const r2 = await pipeline("not-json{{", { ...baseCfg(), degrade_ask_to_deny: false }, {});
  assert.equal(JSON.parse(r2.stdout).hookSpecificOutput.permissionDecision, "ask");
  assert.equal(r2.auditEntry.rendered, "ask");
});

test("main:审计写失败 → stdout 恰一段、决策不受影响、退出 0", async () => {
  const writes = [];
  const code = await main({
    cfg: baseCfg(),
    read: async () => whitelistInput,
    write: (s) => writes.push(s),
    audit: () => { throw new Error("ENOSPC: no space left on device"); },
  });
  assert.equal(code, 0);
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).hookSpecificOutput.permissionDecision, "allow");
});

test("main:决策无法投递(stdout 写入抛错)→ 退出 3,不再触达审计", async () => {
  const code = await main({
    cfg: baseCfg(),
    read: async () => whitelistInput,
    write: () => { throw new Error("EPIPE: broken pipe"); },
    audit: () => { throw new Error("write 失败后不应触达审计"); },
  });
  assert.equal(code, 3);
});
