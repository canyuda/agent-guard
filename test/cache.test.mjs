import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgmentCache } from "../lib/cache.mjs";
import { DEFAULTS } from "../lib/config.mjs";

const tmpCfg = (over = {}) => ({ ...DEFAULTS, cache: { ...DEFAULTS.cache, ...over } });
const tmpPath = () => join(mkdtempSync(join(tmpdir(), "ag-")), "c.json");
const DOCKER = { command: "docker compose down" };

test("store/lookup 往返:同调用命中(含 trim 归一化),不同调用不串", () => {
  const c = judgmentCache(tmpCfg({ path: tmpPath() }));
  c.store("Bash", DOCKER, { risk: 2.0, violation: 0.1 }, 1_000_000);
  assert.deepEqual(c.lookup("Bash", DOCKER, 1_000_000), { risk: 2.0, violation: 0.1 });
  assert.deepEqual(c.lookup("Bash", { command: "  docker compose down  " }, 1_000_000), { risk: 2.0, violation: 0.1 });
  assert.equal(c.lookup("Bash", { command: "git status" }, 1_000_000), null);
});

test("TTL 过期即失效", () => {
  const c = judgmentCache(tmpCfg({ path: tmpPath() }));
  c.store("Bash", DOCKER, { risk: 1.2, violation: 0.1 }, 1_000_000);
  assert.notEqual(c.lookup("Bash", DOCKER, 1_000_000 + 60 * 60_000 - 1), null);
  assert.equal(c.lookup("Bash", DOCKER, 1_000_000 + 60 * 60_000 + 1), null);
});

test("LRU 逐最旧(max_entries=2)", () => {
  const c = judgmentCache(tmpCfg({ path: tmpPath(), max_entries: 2 }));
  c.store("Bash", { command: "a" }, { risk: 0, violation: 0 }, 1_000_000);
  c.store("Bash", { command: "b" }, { risk: 0, violation: 0 }, 1_000_000);
  c.store("Bash", { command: "c" }, { risk: 0, violation: 0 }, 1_000_000);
  assert.equal(c.lookup("Bash", { command: "a" }, 1_000_001), null);
  assert.notEqual(c.lookup("Bash", { command: "c" }, 1_000_001), null);
});

test("store 尽力而为:路径被目录占据只告警,不抛", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const occupied = join(dir, "occupied");
  mkdirSync(occupied); // 目录占据缓存文件位 → writeFileSync EISDIR
  const c = judgmentCache(tmpCfg({ path: occupied }));
  assert.doesNotThrow(() => c.store("Bash", DOCKER, { risk: 0, violation: 0 }, 1_000_000));
});
