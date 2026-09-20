// lib/run-check.mjs — check 主逻辑(自 check.mjs 平移,行为不变)
import { loadConfig } from "./config.mjs";
import { judge } from "./judge.mjs";
import { render } from "./emit.mjs";
import { askTypeSafe } from "./typesafe.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export async function main(argv = []) {
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";

  const tool = flag("--tool") ?? "Bash";
  const input = flag("--input") ? JSON.parse(flag("--input")) : { command: flag("--cmd"), cwd: process.cwd() };
  if (!flag("--cmd") && !flag("--input")) { console.error("用法: check [--cmd <命令> | --tool Write --input <json>] [--mock]"); process.exit(1); }

  const cfg = loadConfig();
  let ask = askTypeSafe;
  if (argv.includes("--mock")) {
    const fix = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "judgments.json"), "utf8"));
    const id = input.command ?? input.file_path;
    if (!(id in fix)) { console.error(`--mock 需要 fixture 条目: ${id}`); process.exit(1); }
    ask = async () => fix[id];
  }
  const r = await judge(tool, input, cfg, { ask });
  const rendered = JSON.parse(render(r.level, r.reason, cfg).stdout).hookSpecificOutput.permissionDecision;
  console.log(`level=${r.level} rendered=${rendered} source=${r.source} risk=${r.judgments?.risk ?? "-"} violation=${r.judgments?.violation ?? "-"} (${r.duration_ms}ms)`);
  console.log(`state=${JSON.stringify(r.state)}`);
}
