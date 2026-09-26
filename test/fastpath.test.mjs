import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { matchFast } from "../lib/fastpath.mjs";
import { DEFAULTS, loadConfig } from "../lib/config.mjs";
import { PKG_ROOT } from "../lib/paths.mjs";

// 名单断言用真实 config.json(守住 spec §6 初始清单);判定缓存的断言见 cache.test.mjs
const CFG = loadConfig(join(PKG_ROOT, "config.json"));

test("MCP 豁免命中 allow", () => {
  const cfg = { ...DEFAULTS, fastpath: { ...DEFAULTS.fastpath, mcp_allowlist: ["lark-cli"] } };
  assert.deepEqual(matchFast("mcp__lark-cli__x", {}, cfg), { hit: true, level: "allow", source: "fastpath_mcp" });
  assert.equal(matchFast("mcp__other__x", {}, cfg).hit, false);
});

test("白名单只读命令 allow", () => {
  assert.equal(matchFast("Bash", { command: "git status" }, CFG).level, "allow");
  assert.equal(matchFast("Bash", { command: "echo hi" }, CFG).level, "allow");
});

test("黑名单破坏命令 block", () => {
  assert.equal(matchFast("Bash", { command: "rm -rf /" }, CFG).level, "block");
  assert.equal(matchFast("Bash", { command: "git push --force origin main" }, CFG).level, "block");
});

test("灰色命令与文件工具不命中", () => {
  assert.equal(matchFast("Bash", { command: "docker compose down" }, CFG).hit, false);
  assert.equal(matchFast("Write", { file_path: "a" }, CFG).hit, false);
});
