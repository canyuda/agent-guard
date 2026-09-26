// lib/paths.mjs — 文件位置抽象(spec §4:env > 用户文件 > 包内默认):数据目录、config/rc/cache 位置与首启复制
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePaths(opts = {}) {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const dataDir = join(home, ".agent-guard");
  return {
    dataDir,
    configPath: env.AGENT_GUARD_CONFIG ?? join(dataDir, "config.json"),
    rcPath: join(home, ".agentguardrc"),
    cachePath: join(dataDir, "cache", "judgments.json"),
  };
}

export function ensureUserConfig(paths = resolvePaths(), pkgRoot = PKG_ROOT) {
  // 只代管默认数据目录里的 config:env 指定路径不碰;文件已存在就不动(哪怕损坏——不覆盖用户数据)
  if (paths.configPath !== join(paths.dataDir, "config.json")) return;
  if (existsSync(paths.configPath)) return;
  try {
    mkdirSync(paths.dataDir, { recursive: true });
    copyFileSync(join(pkgRoot, "config.json"), paths.configPath);
  } catch { /* 包内无默认或不可写:loadConfig 自有兜底 */ }
}
