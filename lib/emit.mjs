// lib/emit.mjs — 三级判定到 ZCode 决策的输出渲染(spec §5 第二层)
// schema 形态以 Task 1 契约实测为准(预计 Claude 形态);不符时只改 buildOutput。
function buildOutput(decision, reason) {
  return { decision, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }) };
}

export function render(level, reason, cfg) {
  if (level === "allow")
    return buildOutput("allow", `[agent-guard] 安全通过(${reason})`);
  if (level === "confirm" && !cfg.degrade_ask_to_deny)
    return buildOutput("ask", `[agent-guard] 需人工确认(${reason})`);
  const head = level === "block" ? "高危禁止" : "需人工确认";
  return buildOutput("deny", `[agent-guard] ${head}(${reason})。此操作需人工确认后才可执行:请停下向用户说明,等待用户自行执行或明确同意;不要重试、不要改写命令规避本拦截。`);
}
