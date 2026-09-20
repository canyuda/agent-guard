import { test } from "node:test";
import assert from "node:assert/strict";
import { askTypeSafe, AgentGuardError } from "../lib/typesafe.mjs";
const cfg = { model: "jev-latest" };
const okPost = async () => ({ answers: {
  destructive_risk: { type: "score", score: 1.7, probabilities: { "0": 0.1, "1": 0.6, "2": 0.3, "3": 0 } },
  policy_violation: { type: "noul", noul: 0.07 },
} });

test("成功:取 score 与 noul", async () => {
  const r = await askTypeSafe({ tool: "Bash", command: "x" }, cfg, { post: okPost, apiKey: "k" });
  assert.equal(r.risk, 1.7);
  assert.equal(r.violation, 0.07);
  assert.equal(r.risk_probabilities["1"], 0.6);
});

test("无 key → no_key", async () => {
  await assert.rejects(askTypeSafe({}, cfg, { post: okPost, apiKey: null }),
    (e) => e instanceof AgentGuardError && e.type === "no_key");
});

test("超时/网络/5xx/401/坏响应分类", async () => {
  const err = (name) => async () => { const e = new Error("x"); e.name = name; throw e; };
  await assert.rejects(askTypeSafe({}, cfg, { post: err("AbortError"), apiKey: "k" }), (e) => e.type === "timeout");
  await assert.rejects(askTypeSafe({}, cfg, { post: err("TypeError"), apiKey: "k" }), (e) => e.type === "network");
  const http = (s) => async () => { const e = new Error(`HTTP ${s}`); e.status = s; throw e; };
  await assert.rejects(askTypeSafe({}, cfg, { post: http(500), apiKey: "k" }), (e) => e.type === "service");
  await assert.rejects(askTypeSafe({}, cfg, { post: http(401), apiKey: "k" }), (e) => e.type === "auth");
  await assert.rejects(askTypeSafe({}, cfg, { post: async () => ({ answers: {} }), apiKey: "k" }), (e) => e.type === "bad_schema");
});
