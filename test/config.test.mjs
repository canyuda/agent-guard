import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveApiKey } from "../lib/config.mjs";

test("config 缺失时返回默认值", () => {
  const cfg = loadConfig(join(mkdtempSync(join(tmpdir(), "ag-")), "none.json"));
  assert.equal(cfg.model, "jev-latest");
  assert.equal(cfg.degrade_ask_to_deny, true);
  assert.equal(cfg.thresholds.block_risk, 2.5);
  assert.equal(cfg.thresholds.confirm_violation, 0.5);
  assert.equal(cfg.cache.ttl_minutes, 60);
});

test("config 文件覆盖默认值(深度合并)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const p = join(dir, "c.json");
  writeFileSync(p, JSON.stringify({ thresholds: { block_risk: 2.0 } }));
  const cfg = loadConfig(p);
  assert.equal(cfg.thresholds.block_risk, 2.0);
  assert.equal(cfg.thresholds.confirm_risk, 1.5);
});

test("API key 解析顺序 env > rc > null", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const rc = join(dir, "rc");
  writeFileSync(rc, 'OTHER=1\nTYPESAFE_API_KEY="sk-123"\n');
  assert.equal(resolveApiKey({ TYPESAFE_API_KEY: "sk-env" }, rc), "sk-env");
  assert.equal(resolveApiKey({}, rc), "sk-123");
  assert.equal(resolveApiKey({}, join(dir, "none")), null);
});
