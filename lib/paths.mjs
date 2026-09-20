// lib/paths.mjs — 数据目录抽象(spec §4:env > 用户文件 > 包内默认)
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePaths(opts = {}) {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const dataDir = join(home, ".agent-guard");
  return {
    dataDir,
    configPath: env.AGENT_GUARD_CONFIG ?? join(dataDir, "config.json"),
    cachePath: join(dataDir, "cache", "judgments.json"),
    logPath: join(dataDir, "logs", "audit.jsonl"),
  };
}

export function ensureUserConfig(paths, pkgRoot = PKG_ROOT) {
  // 只代管默认数据目录里的 config;env 指定路径不碰
  if (paths.configPath !== join(paths.dataDir, "config.json")) return;
  try {
    JSON.parse(readFileSync(paths.configPath, "utf8"));
    return; // 已有合法用户配置,不覆盖(升级保配置)
  } catch { /* 无/损坏 → 从包内默认复制 */ }
  try {
    mkdirSync(paths.dataDir, { recursive: true });
    copyFileSync(join(pkgRoot, "config.json"), paths.configPath);
  } catch { /* 包内无默认或不可写:留空,loadConfig 自有兜底 */ }
}
