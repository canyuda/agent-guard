import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "../lib/judge.mjs";
import { loadConfig } from "../lib/config.mjs";
import { PKG_ROOT } from "../lib/paths.mjs";
import { AgentGuardError } from "../lib/typesafe.mjs";

// 名单来自真实 config.json(守住 §6 初始清单),仅缓存路径指向临时目录
const tmpCfg = (path) => {
  const c = loadConfig(join(PKG_ROOT, "config.json"));
  return { ...c, cache: { ...c.cache, path: path ?? join(mkdtempSync(join(tmpdir(), "ag-")), "c.json") } };
};

test("白名单命中不出网", async () => {
  const r = await judge("Bash", { command: "git status" }, tmpCfg(), { ask: async () => ({ risk: 9, violation: 9 }) });
  assert.equal(r.level, "allow");
  assert.equal(r.source, "fastpath_allow");
});

test("API 结果经 decide 并写缓存(二次走 cache,级不变)", async () => {
  const cfg = tmpCfg();
  const r1 = await judge("Bash", { command: "docker compose down" }, cfg, { ask: async () => ({ risk: 2.0, violation: 0.1 }) });
  assert.equal(r1.level, "confirm");
  assert.equal(r1.source, "api");
  const r2 = await judge("Bash", { command: "docker compose down" }, cfg, { ask: async () => ({ risk: 9, violation: 9 }) });
  assert.equal(r2.source, "cache");
  assert.equal(r2.level, "confirm");
});

test("ask 抛错 → confirm(fail-closed)", async () => {
  const r = await judge("Bash", { command: "x" }, tmpCfg(),
    { ask: async () => { throw new AgentGuardError("timeout", "t"); } });
  assert.equal(r.level, "confirm");
  assert.equal(r.source, "error");
  assert.match(r.reason, /timeout/);
});

test("MCP 豁免 server 直接 allow", async () => {
  const cfg = { ...tmpCfg(), fastpath: { ...loadConfig(join(PKG_ROOT, "config.json")).fastpath, mcp_allowlist: ["lark-cli"] } };
  const r = await judge("mcp__lark-cli__sendMessage", { chat: "x" }, cfg, { ask: async () => ({ risk: 9, violation: 9 }) });
  assert.equal(r.level, "allow");
  assert.equal(r.source, "fastpath_mcp");
});

test("缓存写失败不影响判定(store 尽力而为,source 仍 api)", async () => {
  const occupied = join(mkdtempSync(join(tmpdir(), "ag-")), "occupied");
  mkdirSync(occupied); // 目录占据缓存文件位 → 写入 EISDIR
  const r = await judge("Bash", { command: "docker compose down" }, tmpCfg(occupied), { ask: async () => ({ risk: 2.0, violation: 0.1 }) });
  assert.equal(r.source, "api");
  assert.equal(r.level, "confirm");
});
