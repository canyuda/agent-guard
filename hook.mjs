// hook.mjs — ZCode PreToolUse 入口:stdin→judge→render→stdout+审计(spec §3/§8)
import { loadConfig } from "./lib/config.mjs";
import { judge } from "./lib/judge.mjs";
import { render } from "./lib/emit.mjs";
import { appendAudit } from "./lib/log.mjs";
import { askTypeSafe } from "./lib/typesafe.mjs";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const cfg = loadConfig();
  const ask = process.env.AGENT_GUARD_MOCK_JSON // 测试缝:注入桩判定,不触网
    ? async () => JSON.parse(process.env.AGENT_GUARD_MOCK_JSON)
    : askTypeSafe;
  let toolName = "Unknown", digest = "";
  try {
    const input = JSON.parse(await readStdin()); // 字段名以 Task 1 契约实测为准
    toolName = input.tool_name ?? "Unknown";
    const toolInput = input.tool_input ?? {};
    digest = toolInput.command ?? toolInput.file_path ?? JSON.stringify(toolInput);
    const result = await judge(toolName, toolInput, cfg, { ask });
    const { stdout } = render(result.level, result.reason, cfg);
    const rendered = JSON.parse(stdout).hookSpecificOutput.permissionDecision;
    process.stdout.write(stdout);
    appendAudit({ tool: toolName, input_digest: digest, source: result.source,
      risk: result.judgments?.risk ?? null, risk_probabilities: result.judgments?.risk_probabilities ?? null,
      violation: result.judgments?.violation ?? null, level: result.level, rendered,
      reason: result.reason, duration_ms: result.duration_ms }, cfg);
  } catch (e) {
    try { // 顶层兜底:仍输出 confirm 级决策(spec §8),不静默放行
      const { stdout } = render("confirm", `agent-guard 内部错误(${e?.constructor?.name ?? "Error"})`, cfg);
      process.stdout.write(stdout);
      appendAudit({ tool: toolName, input_digest: digest, source: "error", level: "confirm",
        rendered: "deny", reason: String(e?.message ?? e).slice(0, 200), duration_ms: null }, cfg);
    } catch { process.exit(3); } // 连渲染都失败:非零退出,ZCode 记失败
  }
}
main();
