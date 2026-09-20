import { test } from "node:test";
import assert from "node:assert/strict";
import { buildState } from "../lib/state.mjs";
const cfg = { state: { content_prefix_bytes: 10 } };

test("Bash 提取 command/cwd", () => {
  assert.deepEqual(buildState("Bash", { command: "rm -rf /", cwd: "/x" }, cfg),
    { tool: "Bash", command: "rm -rf /", cwd: "/x" });
});

test("Write 截断 content_prefix", () => {
  const s = buildState("Write", { file_path: "a.txt", content: "0123456789ABCDEF" }, cfg);
  assert.equal(s.file_path, "a.txt");
  assert.equal(s.content_prefix, "0123456789");
});

test("Edit 用 new_string 兜底", () => {
  const s = buildState("Edit", { file_path: "a.js", new_string: "let x=1;" }, cfg);
  assert.equal(s.content_prefix, "let x=1;");
});

test("MCP 解析 server 并序列化参数", () => {
  const s = buildState("mcp__lark-cli__sendMessage", { chat: "x" }, cfg);
  assert.equal(s.server, "lark-cli");
  assert.ok(s.arguments.includes('"chat"'));
});

test("未知工具走 arguments 兜底", () => {
  const s = buildState("Glob", { pattern: "*" }, cfg);
  assert.equal(s.tool, "Glob");
  assert.ok(s.arguments.includes("pattern"));
});
