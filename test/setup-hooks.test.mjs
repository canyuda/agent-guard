import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAgents, targetFile, buildPlan, applyPlan } from "../lib/setup-hooks.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ag-"));
const HOOK_PATH = "C:/fake/pkg/hook.mjs";
const planFor = (agents, scope, home, cwd = tmp()) =>
  buildPlan({ agents, scope, home, cwd, pkgRoot: "C:/fake/pkg" });

test("detectAgents 检测三家", () => {
  const home = tmp();
  mkdirSync(join(home, ".zcode"), { recursive: true });
  mkdirSync(join(home, ".claude"), { recursive: true });
  const r = Object.fromEntries(detectAgents({ home }).map((a) => [a.id, a.detected]));
  assert.deepEqual(r, { zcode: true, claude: true, cursor: false });
});

test("targetFile 六格矩阵", () => {
  const home = tmp(), cwd = tmp();
  assert.equal(targetFile("zcode", "user", { home, cwd }), join(home, ".zcode", "cli", "config.json"));
  assert.equal(targetFile("zcode", "project", { home, cwd }), join(cwd, ".zcode", "config.json"));
  assert.equal(targetFile("claude", "user", { home, cwd }), join(home, ".claude", "settings.json"));
  assert.equal(targetFile("claude", "project", { home, cwd }), join(cwd, ".claude", "settings.json"));
  assert.equal(targetFile("cursor", "user", { home, cwd }), join(home, ".cursor", "hooks.json"));
  assert.equal(targetFile("cursor", "project", { home, cwd }), join(cwd, ".cursor", "hooks.json"));
});

test("project 作用域 cwd==home 拒绝", () => {
  const home = tmp();
  const plan = planFor(["zcode"], "project", home, home);
  assert.equal(plan.rejected, true);
  const r = applyPlan(plan);
  assert.equal(r[0].status, "failed");
});

test("zcode 写入:保留他键,hooks.enabled,条目正确", () => {
  const home = tmp();
  const file = join(home, ".zcode", "cli", "config.json");
  mkdirSync(join(home, ".zcode", "cli"), { recursive: true });
  writeFileSync(file, JSON.stringify({ mcp: { servers: { x: {} } } }));
  const r = applyPlan(planFor(["zcode"], "user", home));
  assert.equal(r[0].status, "written");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(cfg.mcp, { servers: { x: {} } });           // 他键保留
  assert.equal(cfg.hooks.enabled, true);
  const entry = cfg.hooks.events.PreToolUse[0];
  assert.equal(entry.matcher, "Bash|Write|Edit|mcp__.*");
  assert.equal(entry.hooks[0].type, "process");
  assert.equal(entry.hooks[0].args[0], HOOK_PATH);
  assert.equal(entry.hooks[0].timeoutMs, 15000);
});

test("claude 写入:保留既有 Stop/SessionEnd", () => {
  const home = tmp();
  const file = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "notify" }] }] } }));
  const r = applyPlan(planFor(["claude"], "user", home));
  assert.equal(r[0].status, "written");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(cfg.hooks.Stop[0].hooks[0].command, "notify");  // 原样保留
  assert.equal(cfg.hooks.PreToolUse[0].hooks[0].command, `node "${HOOK_PATH}"`);
  assert.equal(cfg.hooks.PreToolUse[0].hooks[0].timeout, 15);
});

test("cursor 写入:原生形态 failClosed", () => {
  const home = tmp();
  const r = applyPlan(planFor(["cursor"], "user", home));
  assert.equal(r[0].status, "written");
  const cfg = JSON.parse(readFileSync(join(home, ".cursor", "hooks.json"), "utf8"));
  assert.equal(cfg.version, 1);
  const e = cfg.hooks.preToolUse[0];
  assert.equal(e.command, `node "${HOOK_PATH}"`);
  assert.equal(e.timeout, 15);
  assert.equal(e.matcher, "Shell|Write|Edit|MCP:");
  assert.equal(e.failClosed, true);
});

test("幂等:同 plan 跑两次条目数不变,第二次 updated", () => {
  const home = tmp();
  const p = planFor(["claude"], "user", home);
  applyPlan(p);
  const r2 = applyPlan(p);
  assert.equal(r2[0].status, "updated");
  const cfg = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(cfg.hooks.PreToolUse.length, 1);
});

test("备份 .bak 为写前内容", () => {
  const home = tmp();
  const file = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(file, JSON.stringify({ old: 1 }));
  applyPlan(planFor(["claude"], "user", home));
  assert.equal(JSON.parse(readFileSync(file + ".bak", "utf8")).old, 1);
});

test("损坏 JSON:failed 且原文件未动", () => {
  const home = tmp();
  const file = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(file, "not-json{");
  const r = applyPlan(planFor(["claude"], "user", home));
  assert.equal(r[0].status, "failed");
  assert.equal(readFileSync(file, "utf8"), "not-json{");
});

test("dryRun:不写盘", () => {
  const home = tmp();
  const r = applyPlan(planFor(["zcode"], "user", home), { dryRun: true });
  assert.equal(r[0].status, "dry-run");
  let exists = true;
  try { readFileSync(join(home, ".zcode", "cli", "config.json")); } catch { exists = false; }
  assert.equal(exists, false);
});
