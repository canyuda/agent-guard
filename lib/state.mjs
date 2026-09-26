// lib/state.mjs — 按工具构造 TypeSafe state(spec §4);身份字段取自 identity.mjs(单一来源)
import { toolIdentity } from "./identity.mjs";

export function buildState(toolName, toolInput, cfg) {
  const cap = cfg.state.content_prefix_bytes;
  const id = toolIdentity(toolName, toolInput);
  if (id.kind === "bash")
    return { tool: toolName, command: id.command, cwd: String(toolInput.cwd ?? "") };
  if (id.kind === "file")
    return { tool: toolName, file_path: id.filePath, content_prefix: id.content.slice(0, cap) };
  if (id.kind === "mcp")
    return { tool: toolName, server: id.server, arguments: id.args.slice(0, cap) };
  return { tool: toolName, arguments: id.args.slice(0, cap) };
}
