import { test } from "node:test";
import assert from "node:assert/strict";
import { toolIdentity, identityDigest } from "../lib/identity.mjs";
import { cacheKey } from "../lib/fastpath.mjs";
import { buildState } from "../lib/state.mjs";

const cfg = { state: { content_prefix_bytes: 2048 } };

test("Bash:command 原样属身份,cwd 不属;不 trim(trim 是缓存归一化的事)", () => {
  assert.deepEqual(toolIdentity("Bash", { command: "ls", cwd: "/x" }), { kind: "bash", command: "ls" });
  assert.equal(identityDigest(toolIdentity("Bash", { command: " ls " })), " ls ");
});

test("Write/Edit/ApplyPatch:file_path??path 与 content??new_string 别名收敛一处", () => {
  for (const t of ["Write", "Edit", "ApplyPatch"]) {
    assert.deepEqual(toolIdentity(t, { path: "p", new_string: "n" }), { kind: "file", filePath: "p", content: "n" });
    assert.deepEqual(toolIdentity(t, { file_path: "p", content: "c" }), { kind: "file", filePath: "p", content: "c" });
  }
  assert.equal(identityDigest(toolIdentity("Write", { file_path: "a" })), "a");
});

test("mcp:server 解析收敛,参数序列化键序无关", () => {
  const a = toolIdentity("mcp__lark-cli__send", { chat: "x", id: 1 });
  assert.equal(a.kind, "mcp");
  assert.equal(a.server, "lark-cli");
  assert.equal(a.args, toolIdentity("mcp__lark-cli__send", { id: 1, chat: "x" }).args);
});

test("未知工具:args 兜底且键序无关", () => {
  assert.equal(toolIdentity("Glob", { a: 1, b: 2 }).kind, "args");
  assert.equal(toolIdentity("Glob", { a: 1, b: 2 }).args, toolIdentity("Glob", { b: 2, a: 1 }).args);
});

test("state 与缓存键同源:内容变则两者皆变(结构上不可能分叉)", () => {
  const i1 = { file_path: "a", content: "x" }, i2 = { file_path: "a", content: "y" };
  assert.notEqual(cacheKey("Write", i1), cacheKey("Write", i2));
  assert.notEqual(buildState("Write", i1, cfg).content_prefix, buildState("Write", i2, cfg).content_prefix);
});

test("修复:mcp 带 file_path 时缓存键对全部参数敏感(原 path+空内容碰撞)", () => {
  assert.notEqual(
    cacheKey("mcp__fs__write", { file_path: "a", data: "1" }),
    cacheKey("mcp__fs__write", { file_path: "a", data: "2" }));
});
