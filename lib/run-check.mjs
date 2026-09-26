// lib/run-check.mjs — check 主逻辑:参数解析已上收 cli.parseArgs,这里只剩 mock 装配与打印
import { loadConfig } from "./config.mjs";
import { judge } from "./judge.mjs";
import { render } from "./emit.mjs";
import { askTypeSafe } from "./typesafe.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_ROOT, ensureUserConfig } from "./paths.mjs";
import { toolIdentity, identityDigest } from "./identity.mjs";

export async function main(flags = {}) {
  const tool = flags.tool ?? "Bash";
  let input;
  if (flags.input) {
    try { input = JSON.parse(flags.input); }
    catch { console.error(`--input 不是合法 JSON: ${String(flags.input).slice(0, 80)}`); process.exit(1); }
  } else if (flags.cmd) {
    input = { command: flags.cmd, cwd: process.cwd() };
  } else {
    console.error("用法: check [--cmd <命令> | --tool X --input <json>] [--mock]"); process.exit(1);
  }

  ensureUserConfig();
  const cfg = loadConfig();
  let ask = askTypeSafe;
  if (flags.mock) {
    const fix = JSON.parse(readFileSync(join(PKG_ROOT, "test", "fixtures", "judgments.json"), "utf8"));
    const id = identityDigest(toolIdentity(tool, input));
    if (!(id in fix)) { console.error(`--mock 需要 fixture 条目: ${id}`); process.exit(1); }
    ask = async () => fix[id];
  }
  const r = await judge(tool, input, cfg, { ask });
  const riskPct = r.judgments ? `${Math.round((r.judgments.risk / 3) * 100)}%` : "-";
  const violationPct = r.judgments ? `${Math.round(r.judgments.violation * 100)}%` : "-";
  console.log(`level=${r.level} rendered=${render(r.level, r.reason, cfg).decision} source=${r.source} 破坏性风险=${riskPct} 红线违反=${violationPct} (${r.duration_ms}ms)`);
  console.log(`state=${JSON.stringify(r.state)}`);
}
