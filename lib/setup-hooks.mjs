// lib/setup-hooks.mjs — 目标矩阵/计划构建/备份幂等 upsert(spec §6.2;Cursor 形态见 docs/notes/2026-09-20-cursor-hooks-findings.md)
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const MATCHER = "Bash|Write|Edit|mcp__.*";
const AGENTS = ["zcode", "claude", "cursor"];

export function detectAgents({ home }) {
  return AGENTS.map((id) => ({
    id,
    detected: {
      zcode: existsSync(join(home, ".zcode")),
      claude: existsSync(join(home, ".claude")),
      cursor: existsSync(join(home, ".cursor")),
    }[id],
  }));
}

export function targetFile(agentId, scope, { home, cwd }) {
  const base = scope === "user" ? home : cwd;
  return {
    zcode: scope === "user" ? join(home, ".zcode", "cli", "config.json") : join(base, ".zcode", "config.json"),
    claude: join(base, ".claude", "settings.json"),
    cursor: join(base, ".cursor", "hooks.json"),
  }[agentId];
}

export function buildHookEntry(agentId, hookPath) {
  if (agentId === "zcode")
    return { matcher: MATCHER, hooks: [{ type: "process", command: "node", args: [hookPath], timeoutMs: 15000 }] };
  if (agentId === "cursor")
    return { command: `node "${hookPath}"`, timeout: 15, matcher: "Shell|Write|Edit|MCP:", failClosed: true };
  return { matcher: MATCHER, hooks: [{ type: "command", command: `node "${hookPath}"`, timeout: 15 }] };
}

export function buildPlan({ agents, scope, home, cwd, pkgRoot }) {
  if (scope === "project" && cwd === home)
    return { rejected: true, reason: `project 作用域的当前目录(${cwd})与用户主目录相同,项目级路径会与用户级路径重叠;请在项目目录内运行或改用 --scope user` };
  const hookPath = join(pkgRoot, "hook.mjs").replaceAll("\\", "/");
  return {
    rejected: false,
    items: agents.filter((a) => AGENTS.includes(a)).map((agent) => {
      const file = targetFile(agent, scope, { home, cwd });
      return { agent, file, entry: buildHookEntry(agent, hookPath), fileExists: existsSync(file) };
    }),
  };
}

// 各工具的容器访问器:给定已解析的 config 对象,返回本项目条目所在数组(按需建容器)
function hookArray(agent, cfg) {
  if (agent === "zcode") {
    cfg.hooks ??= {};
    cfg.hooks.enabled = true;
    cfg.hooks.events ??= {};
    return (cfg.hooks.events.PreToolUse ??= []);
  }
  if (agent === "cursor") {
    cfg.version ??= 1;
    cfg.hooks ??= {};
    return (cfg.hooks.preToolUse ??= []);
  }
  cfg.hooks ??= {};
  return (cfg.hooks.PreToolUse ??= []);
}

export function applyPlan(plan, { dryRun = false } = {}) {
  if (plan.rejected)
    return [{ agent: "-", status: "failed", detail: plan.reason }];
  const results = [];
  for (const item of plan.items) {
    if (dryRun) { results.push({ agent: item.agent, status: "dry-run", file: item.file }); continue; }
    let cfg = {};
    const fileExists = existsSync(item.file); // apply 时实查,不信 plan 里的快照
    if (fileExists) {
      try {
        cfg = JSON.parse(readFileSync(item.file, "utf8"));
      } catch {
        results.push({ agent: item.agent, status: "failed", detail: "目标文件不是合法 JSON,未做任何修改(请手动处理后再试)" });
        continue;
      }
      copyFileSync(item.file, item.file + ".bak"); // 备份为写前内容
    }
    const arr = hookArray(item.agent, cfg);
    const idx = arr.findIndex((e) => JSON.stringify(e).includes("hook.mjs")); // 本项目条目识别
    const status = idx >= 0 ? (arr[idx] = item.entry, "updated") : (arr.push(item.entry), "written");
    mkdirSync(dirname(item.file), { recursive: true });
    writeFileSync(item.file, JSON.stringify(cfg, null, 2) + "\n");
    results.push({ agent: item.agent, status, file: item.file });
  }
  return results;
}
