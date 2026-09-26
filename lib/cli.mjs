// lib/cli.mjs — 参数解析与 setup 向导(spec §5/§6;交互壳薄层,核心在 setup-key/setup-hooks)
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { loadConfig } from "./config.mjs";
import { detectKey, maskKey, writeRc, verifyKey } from "./setup-key.mjs";
import { detectAgents, buildPlan, applyPlan } from "./setup-hooks.mjs";
import { PKG_ROOT, resolvePaths, ensureUserConfig } from "./paths.mjs";

export const USAGE = `用法: agent-guard <command> [options]

命令:
  setup    配置 key 并挂载 AI 编程工具的 PreToolUse hook(交互向导)
  check    手动评估一条命令/工具调用(--cmd <命令> | --tool X --input <json> [--mock])
  hook     hook 管道模式(stdin JSON → 判定 → stdout,供各工具调用)
  --version / --help`;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v") return { cmd: "version", flags: {} };
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return { cmd: "help", flags: {} };
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--no-verify") flags.noVerify = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--key") flags.key = rest[++i];
    else if (a === "--agents") flags.agents = rest[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--scope") flags.scope = rest[++i];
    else flags._ = (flags._ ?? []).concat(a);
  }
  return { cmd, flags };
}

function defaultIo() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { ask: (q) => rl.question(q), close: () => rl.close() };
}

export async function runSetup(flags, io = defaultIo()) {
  try {
    // [1/4] key
    ensureUserConfig(); // 首启复制数据目录 config(loadConfig 已纯化)
    let key = flags.key ?? null;
    if (!key) {
      const d = await detectKey();
      if (d.key) {
        const use = await io.ask(`[1/4] 探测到 TypeSafe key(来源:${d.source},值:${maskKey(d.key)})使用它吗?[Y/n] `);
        if (!/^n/i.test(use.trim())) key = d.key;
      }
      if (!key) key = (await io.ask("[1/4] 输入 TYPESAFE_API_KEY(注意:输入会回显在屏幕上): ")).trim();
    }
    if (!key) { console.error("未提供 key,退出"); process.exitCode = 1; return; }
    const rcPath = resolvePaths().rcPath;
    if (!flags.noVerify) {
      const v = await verifyKey(key, loadConfig());
      console.log(v.ok ? "[1/4] key 验证通过(真实 API)" : `[1/4] key 验证失败(${v.type}),将继续写入,可稍后用 agent-guard check 复测`);
    }

    // [2/4] 工具多选
    let agents = flags.agents;
    if (!agents || agents.length === 0) {
      const detected = detectAgents({ home: homedir() });
      const label = detected.map((a, i) => `${i + 1}=${a.id}${a.detected ? "(已装)" : ""}`).join(" ");
      const ans = await io.ask(`[2/4] 选择工具(逗号分隔编号,回车=全部已装:${label}): `);
      const map = detected.map((a) => a.id);
      agents = ans.trim() === "" ? detected.filter((a) => a.detected).map((a) => a.id)
        : ans.split(/[,,]/).map((n) => map[+n.trim() - 1]).filter(Boolean);
    }

    // [3/4] 作用域
    let scope = flags.scope;
    if (scope !== "user" && scope !== "project") {
      const ans = await io.ask("[3/4] 作用域(1=用户级 ~ 全部项目 / 2=项目级 当前目录,回车=1): ");
      scope = ans.trim() === "2" ? "project" : "user";
    }

    // [4/4] 计划与确认
    const plan = buildPlan({ agents, scope, home: homedir(), cwd: process.cwd(), pkgRoot: PKG_ROOT });
    console.log("[4/4] 计划:");
    if (plan.rejected) console.log(`  拒绝执行:${plan.reason}`);
    else for (const it of plan.items) console.log(`  ${it.agent} → ${it.file}`);
    if (flags.dryRun) { console.log("dry-run:未写入任何文件(含 ~/.agentguardrc)"); return; }
    if (plan.rejected) { process.exitCode = 1; return; }
    if (!flags.yes) {
      const ok = await io.ask("确认写入?(y/N) ");
      if (!/^y/i.test(ok.trim())) { console.log("已取消,未写入"); return; }
    }
    writeRc(rcPath, key); // rc 写入推迟到确认之后(dry-run/取消都不落盘)
    console.log(`key 已写入 ${rcPath}`);
    for (const r of applyPlan(plan)) console.log(`  ${r.agent}: ${r.status}${r.detail ? ` — ${r.detail}` : ""}`);
    console.log("完成。重启对应工具后生效。");
  } finally {
    io.close?.();
  }
}
