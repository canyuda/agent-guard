import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../lib/emit.mjs";
import { DEFAULTS } from "../lib/config.mjs";

const parse = (s) => JSON.parse(s).hookSpecificOutput;

test("allow 渲染", () => {
  const o = parse(render("allow", "risk=0.10", DEFAULTS).stdout);
  assert.equal(o.permissionDecision, "allow");
  assert.match(o.permissionDecisionReason, /\[agent-guard\]/);
});

test("degrade=true:confirm/block 都渲染为 deny,文案含禁止绕路", () => {
  const cfg = { ...DEFAULTS, degrade_ask_to_deny: true };
  for (const level of ["confirm", "block"]) {
    const o = parse(render(level, "risk=2.00 violation=0.60", cfg).stdout);
    assert.equal(o.permissionDecision, "deny");
    assert.match(o.permissionDecisionReason, /需人工确认/);
    assert.match(o.permissionDecisionReason, /不要重试/);
  }
});

test("degrade=false:confirm 渲染为 ask,block 仍 deny", () => {
  const cfg = { ...DEFAULTS, degrade_ask_to_deny: false };
  assert.equal(parse(render("confirm", "r", cfg).stdout).permissionDecision, "ask");
  assert.equal(parse(render("block", "r", cfg).stdout).permissionDecision, "deny");
});
