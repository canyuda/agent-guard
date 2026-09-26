// test/sample-set.test.mjs — spec §10 十二条样例:fastpath 直接判,API 样例用 fixtures stub
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "../lib/judge.mjs";
import { render } from "../lib/emit.mjs";
import { loadConfig, PROJECT_ROOT } from "../lib/config.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(ROOT, "fixtures", "judgments.json"), "utf8"));
const mkAsk = (id) => async () => { if (!(id in FIX)) throw new Error(`fixture 缺失: ${id}`); return FIX[id]; };
const CACHE = join(ROOT, "..", ".cache", "test-samples.json");
rmSync(CACHE, { force: true });
const BASE = loadConfig(join(PROJECT_ROOT, "config.json"));
const cfg = { ...BASE, cache: { ...BASE.cache, path: CACHE } };

const CASES = [
  ["Bash", { command: "git status" }, "allow"],
  ["Bash", { command: "node --version" }, "allow"],
  ["Bash", { command: "npm install lodash" }, "allow"],
  ["Write", { file_path: "src/Main.java", content: "public class Main {}" }, "allow"],
  ["Bash", { command: "git reset --hard HEAD~1" }, "confirm"],
  ["Bash", { command: "docker compose down" }, "confirm"],
  ["Bash", { command: "taskkill /F /IM java.exe" }, "confirm"],
  ["Bash", { command: "rm -rf /" }, "block"],
  ["Bash", { command: "git push --force origin main" }, "block"],
  ["Write", { file_path: "/etc/sudoers", content: "root ALL=(ALL) ALL" }, "block"],
  ["Bash", { command: ":(){ :|:& };:" }, "block"],
  ["Bash", { command: "echo hi" }, "allow"],
];

test("§10 样例集:判定级与渲染(degrade 默认)", async (t) => {
  for (const [tool, input, expected] of CASES) {
    await t.test(`${tool} ${JSON.stringify(input).slice(0, 40)}`, async () => {
      const id = input.command ?? input.file_path;
      const r = await judge(tool, input, cfg, { ask: mkAsk(id) });
      assert.equal(r.level, expected);
      const rendered = JSON.parse(render(r.level, r.reason, cfg).stdout).hookSpecificOutput.permissionDecision;
      const wantRendered = expected === "allow" ? "allow" : (expected === "block" || cfg.degrade_ask_to_deny) ? "deny" : "ask";
      assert.equal(rendered, wantRendered);
    });
  }
});
