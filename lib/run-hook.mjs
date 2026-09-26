// lib/run-hook.mjs — hook 管道:pipeline 纯核心(stdin 原文 → 决策+审计条目) + main 薄壳(IO/退出码)
// 决策只写一次:主路径与兜底共用 render 的返回值,审计 rendered 恒等于实际输出(spec §8 fail-closed)
import { loadConfig } from "./config.mjs";
import { ensureUserConfig } from "./paths.mjs";
import { judge } from "./judge.mjs";
import { render } from "./emit.mjs";
import { appendAudit } from "./log.mjs";
import { askTypeSafe } from "./typesafe.mjs";
import { toolIdentity, identityDigest } from "./identity.mjs";

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// 不做任何 IO(ask 经 deps 注入):非法输入、judge/render 异常都在这里转为兜底决策或 exitCode 3
export async function pipeline(raw, cfg, deps = {}) {
  let toolName = "Unknown", digest = "";
  try {
    const input = JSON.parse(raw); // 契约实测:snake_case 兼容字段(docs/notes/2026-09-20-contract-findings.md)
    toolName = input.tool_name ?? "Unknown";
    const toolInput = input.tool_input ?? {};
    digest = identityDigest(toolIdentity(toolName, toolInput));
    const result = await judge(toolName, toolInput, cfg, deps);
    const { stdout, decision } = render(result.level, result.reason, cfg);
    return { stdout, auditEntry: { tool: toolName, input_digest: digest, source: result.source,
      risk: result.judgments?.risk ?? null, risk_probabilities: result.judgments?.risk_probabilities ?? null,
      violation: result.judgments?.violation ?? null, level: result.level, rendered: decision,
      reason: result.reason, duration_ms: result.duration_ms } };
  } catch (e) {
    try { // 顶层兜底:仍输出 confirm 级决策(spec §8),不静默放行;rendered 取实际输出
      const { stdout, decision } = render("confirm", `agent-guard 内部错误(${e?.constructor?.name ?? "Error"})`, cfg);
      return { stdout, auditEntry: { tool: toolName, input_digest: digest, source: "error", level: "confirm",
        rendered: decision, reason: String(e?.message ?? e).slice(0, 200), duration_ms: null } };
    } catch {
      return { exitCode: 3 }; // 连渲染都失败:无决策可产出,宿主按 hook 失败处理
    }
  }
}

// 薄壳:read/write/audit/cfg 可注入(默认真实 IO),返回退出码,进程内可测
export async function main(opts = {}) {
  const read = opts.read ?? readStdin;
  const write = opts.write ?? ((s) => process.stdout.write(s));
  const audit = opts.audit ?? appendAudit;
  let cfg = opts.cfg;
  if (!cfg) { ensureUserConfig(); cfg = loadConfig(); } // 默认路径才做首启复制
  const deps = { ask: process.env.AGENT_GUARD_MOCK_JSON // 测试缝:注入桩判定,不触网
    ? async () => JSON.parse(process.env.AGENT_GUARD_MOCK_JSON)
    : askTypeSafe };
  let r;
  try {
    r = await pipeline(await read(), cfg, deps);
  } catch {
    return 3; // 管道意外崩溃:决策未投递 = fail-closed
  }
  if (r.exitCode === 3) return 3;
  try {
    write(r.stdout); // 决策只写一次:此前的任何失败都不会再产出第二段输出
  } catch {
    return 3; // 投递失败(如宿主关管道):决策未送达,不写审计
  }
  try {
    audit(r.auditEntry, cfg);
  } catch (e) { // 决策已投递:审计缺失进 stderr 可见,不破坏 stdout 契约
    console.error(`agent-guard: 审计写入失败(${e?.message ?? e})`);
  }
  return 0;
}
