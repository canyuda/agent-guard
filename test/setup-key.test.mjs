import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectKey, maskKey, writeRc, verifyKey } from "../lib/setup-key.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ag-"));

test("detectKey 顺序 env > registry > rc > none", async () => {
  const dir = tmp();
  const rc = join(dir, "rc");
  writeFileSync(rc, 'TYPESAFE_API_KEY="sk-rc"\n');
  assert.deepEqual(await detectKey({ env: { TYPESAFE_API_KEY: "sk-env" }, rcPath: rc, readRegistry: async () => "sk-reg" }),
    { source: "env", key: "sk-env" });
  assert.deepEqual(await detectKey({ env: {}, rcPath: rc, readRegistry: async () => "sk-reg" }),
    { source: "registry", key: "sk-reg" });
  assert.deepEqual(await detectKey({ env: {}, rcPath: rc, readRegistry: async () => null }),
    { source: "rc", key: "sk-rc" });
  assert.deepEqual(await detectKey({ env: {}, rcPath: join(dir, "none"), readRegistry: async () => null }),
    { source: "none", key: null });
});

test("maskKey 首尾各 2,过短全遮", () => {
  assert.equal(maskKey("tsk-abcdef1234"), "ts***34");
  assert.equal(maskKey("abc"), "***");
});

test("writeRc 新写与备份", () => {
  const dir = tmp();
  const rc = join(dir, "agentguardrc");
  writeRc(rc, "sk-new");
  assert.equal(readFileSync(rc, "utf8"), 'TYPESAFE_API_KEY="sk-new"\n');
  writeRc(rc, "sk-two");
  assert.equal(readFileSync(rc, "utf8"), 'TYPESAFE_API_KEY="sk-two"\n');
  assert.equal(readFileSync(rc + ".bak", "utf8"), 'TYPESAFE_API_KEY="sk-new"\n');
});

test("verifyKey 成功与 auth 失败分类", async () => {
  const okPost = async () => ({ answers: { destructive_risk: { score: 0, probabilities: null }, policy_violation: { noul: 0 } } });
  assert.deepEqual(await verifyKey("k", { model: "jev-latest" }, { post: okPost }), { ok: true });
  const http = (s) => async () => { const e = new Error(`HTTP ${s}`); e.status = s; throw e; };
  assert.deepEqual(await verifyKey("k", { model: "jev-latest" }, { post: http(401) }), { ok: false, type: "auth" });
});
