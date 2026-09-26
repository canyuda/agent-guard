// lib/run-check.mjs — check 主逻辑(自 check.mjs 平移,行为不变)
import { loadConfig } from "./config.mjs";
import { ensureUserConfig } from "./paths.mjs";
import { judge } from "./judge.mjs";
import { render } from "./emit.mjs";
import { askTypeSafe } from "./typesafe.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_ROOT } from "./paths.mjs";
import { toolIdentity, identityDigest } from "./identity.mjs";

export async function main(argv = []) {
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

  const tool = flag("--tool") ?? "Bash";
  const input = flag("--input") ? JSON.parse(flag("--input")) : { command: flag("--cmd"), cwd: process.cwd() };
  if (!flag("--cmd") && !flag("--input")) { console.error("用法: check [--cmd <命令> | --tool Write --input <json>] [--mock]"); process.exit(1); }

  ensureUserConfig();
  const cfg = loadConfig();
  let ask = askTypeSafe;
  if (argv.includes("--mock")) {
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
