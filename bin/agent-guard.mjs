#!/usr/bin/env node
// bin/agent-guard.mjs — 统一 CLI 入口(spec §5)
import { parseArgs, runSetup, USAGE } from "../lib/cli.mjs";
import { main as runHook } from "../lib/run-hook.mjs";
import { main as runCheck } from "../lib/run-check.mjs";

const { cmd, flags } = parseArgs(process.argv.slice(2));

switch (cmd) {
  case "version": {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(pkg.default.version);
    break;
  }
  case "setup":
    await runSetup(flags);
    break;
  case "check":
    await runCheck(flags._ ?? []);
    break;
  case "hook":
    process.exitCode = (await runHook()) ?? 3;
    break;
  default:
    console.log(USAGE);
    process.exitCode = 1;
}
