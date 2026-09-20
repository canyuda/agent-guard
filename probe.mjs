// probe.mjs — 契约探针:转储 stdin,按 probe-decision.txt 渲染决策(Task 1,临时保留)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const raw = Buffer.concat(chunks).toString("utf8");
writeFileSync(join(ROOT, "probe-dump.json"), raw);
let decision = "allow";
try { decision = readFileSync(join(ROOT, "probe-decision.txt"), "utf8").trim() || "allow"; } catch {}
const out = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
    permissionDecisionReason: `[probe] 故意渲染 ${decision},用于契约验证`,
  },
};
process.stdout.write(JSON.stringify(out));
