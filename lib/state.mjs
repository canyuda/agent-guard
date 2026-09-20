// lib/state.mjs — 按工具构造 TypeSafe state(spec §4)
export function buildState(toolName, toolInput, cfg) {
  const cap = cfg.state.content_prefix_bytes;
  const prefix = (s) => String(s ?? "").slice(0, cap);
  const stable = (o) => prefix(JSON.stringify(o, Object.keys(o ?? {}).sort()));
  if (toolName === "Bash")
    return { tool: toolName, command: String(toolInput.command ?? ""), cwd: String(toolInput.cwd ?? "") };
  if (toolName === "Write" || toolName === "Edit" || toolName === "ApplyPatch")
    return { tool: toolName, file_path: String(toolInput.file_path ?? toolInput.path ?? ""),
             content_prefix: prefix(toolInput.content ?? toolInput.new_string ?? "") };
  if (toolName.startsWith("mcp__"))
    return { tool: toolName, server: toolName.split("__")[1] ?? "", arguments: stable(toolInput) };
  return { tool: toolName, arguments: stable(toolInput) };
}
