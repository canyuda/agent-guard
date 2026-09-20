import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchFast, cacheKey, cacheLookup, cacheStore } from "../lib/fastpath.mjs";
import { DEFAULTS, loadConfig, PROJECT_ROOT } from "../lib/config.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ag-"));
// 名单断言用真实 config.json(守住 spec §6 初始清单);缓存断言用 DEFAULTS
const CFG = loadConfig(join(PROJECT_ROOT, "config.json"));

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

test("缓存写入/命中/TTL 边界/LRU 逐最旧", () => {
  const p = join(tmp(), "c.json");
  const now = 1_000_000;
  cacheStore(p, "k1", { risk: 1.2, violation: 0.1 }, DEFAULTS, now);
  assert.deepEqual(cacheLookup(p, "k1", now + 60 * 60_000 - 1), { risk: 1.2, violation: 0.1 });
  assert.equal(cacheLookup(p, "k1", now + 60 * 60_000 + 1), null);
  const cfg2 = { ...DEFAULTS, cache: { ttl_minutes: 60, max_entries: 2 } };
  cacheStore(p, "k2", { risk: 0, violation: 0 }, cfg2, now);
  cacheStore(p, "k3", { risk: 0, violation: 0 }, cfg2, now);
  assert.equal(cacheLookup(p, "k1", now + 1), null);
  assert.notEqual(cacheLookup(p, "k3", now + 1), null);
});

test("cacheKey 稳定且 trim 生效", () => {
  assert.equal(cacheKey("Bash", { command: " ls " }), cacheKey("Bash", { command: "ls" }));
  assert.notEqual(cacheKey("Bash", { command: "ls" }), cacheKey("Bash", { command: "ls -la" }));
});
