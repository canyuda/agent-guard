// lib/identity.mjs — 工具调用身份的唯一来源:字段别名(file_path??path、content??new_string)、
// server 解析、键序无关的稳定序列化只写在这里。state(发给 API)、缓存键、审计摘要共同消费,
// 结构上保证三者指向同一次调用。
function stableJson(value) {
  return JSON.stringify(value ?? {}, Object.keys(value ?? {}).sort());
}

export function toolIdentity(toolName, toolInput = {}) {
  if (toolName === "Bash") return { kind: "bash", command: String(toolInput.command ?? "") };
  if (toolName === "Write" || toolName === "Edit" || toolName === "ApplyPatch")
    return { kind: "file", filePath: String(toolInput.file_path ?? toolInput.path ?? ""), content: String(toolInput.content ?? toolInput.new_string ?? "") };
  if (toolName.startsWith("mcp__"))
    return { kind: "mcp", server: toolName.split("__")[1] ?? "", args: stableJson(toolInput) };
  return { kind: "args", args: stableJson(toolInput) };
}

// 人类可读摘要:审计 input_digest 与 check 展示(trim/截断由消费方负责)
export function identityDigest(identity) {
  return identity.kind === "bash" ? identity.command
    : identity.kind === "file" ? identity.filePath
    : identity.args;
}
