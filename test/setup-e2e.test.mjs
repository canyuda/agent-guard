import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PROJECT_ROOT } from "../lib/config.mjs";

const BIN = join(PROJECT_ROOT, "bin", "agent-guard.mjs");
const setupEnv = () => {
  const home = mkdtempSync(join(tmpdir(), "ag-"));
  return { home, env: { ...process.env, USERPROFILE: home, HOME: home, AGENT_GUARD_CONFIG: join(home, "cfg.json") } };
};
const run = (args, env, cwd) =>
  spawnSync(process.execPath, [BIN, "setup", ...args], { encoding: "utf8", env, cwd });

test("dry-run:计划表输出,零写盘(含 rc)", () => {
  const { home, env } = setupEnv();
  const r = run(["--key", "k-test", "--agents", "zcode,claude", "--scope", "user", "--dry-run", "--no-verify"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /zcode → .*\.zcode.*config\.json/);
  assert.match(r.stdout, /claude → .*\.claude.*settings\.json/);
  assert.match(r.stdout, /dry-run/);
  assert.equal(existsSync(join(home, ".agentguardrc")), false, "dry-run 不应写 rc");
  assert.equal(existsSync(join(home, ".zcode")), false);
});

test("实写:rc + 两工具配置落盘,重跑幂等", () => {
  const { home, env } = setupEnv();
  const args = ["--key", "k-test", "--agents", "zcode,claude", "--scope", "user", "--yes", "--no-verify"];
  const r1 = run(args, env);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /zcode: written/);
  assert.match(r1.stdout, /claude: written/);
  assert.equal(readFileSync(join(home, ".agentguardrc"), "utf8"), 'TYPESAFE_API_KEY="k-test"\n');
  const zc = JSON.parse(readFileSync(join(home, ".zcode", "cli", "config.json"), "utf8"));
  assert.equal(zc.hooks.enabled, true);
  const r2 = run(args, env);
  assert.match(r2.stdout, /zcode: updated/);
  assert.equal(JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8")).hooks.PreToolUse.length, 1);
});

test("project 作用域:写当前目录配置", () => {
  const { home, env } = setupEnv();
  const cwd = mkdtempSync(join(tmpdir(), "ag-proj-"));
  const r = run(["--key", "k", "--agents", "zcode", "--scope", "project", "--yes", "--no-verify"], env, cwd);
  assert.equal(r.status, 0, r.stderr);
  const cfg = JSON.parse(readFileSync(join(cwd, ".zcode", "config.json"), "utf8"));
  assert.equal(cfg.hooks.enabled, true);
  assert.equal(existsSync(join(home, ".zcode")), false, "用户级不应被触碰");
});
