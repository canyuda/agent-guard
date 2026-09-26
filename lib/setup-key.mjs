// lib/setup-key.mjs — key 探测/掩码/写入/验证(spec §6 [1/4];key 绝不入日志)
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, copyFileSync } from "node:fs";
import { resolvePaths } from "./paths.mjs";
import { readRc } from "./config.mjs";
import { askTypeSafe, AgentGuardError } from "./typesafe.mjs";

// win32:从用户注册表读 TYPESAFE_API_KEY(只回传值,不打印)
async function defaultReadRegistry() {
  if (process.platform !== "win32") return null;
  const r = spawnSync("powershell", [
    "-NoProfile", "-Command",
    "[Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','User')",
  ], { encoding: "utf8", timeout: 8000 });
  const v = (r.stdout ?? "").trim();
  return v || null;
}

export async function detectKey(deps = {}) {
  const env = deps.env ?? process.env;
  const rcPath = deps.rcPath ?? resolvePaths().rcPath;
  const readRegistry = deps.readRegistry ?? defaultReadRegistry;
  if (env.TYPESAFE_API_KEY) return { source: "env", key: String(env.TYPESAFE_API_KEY) };
  const reg = await readRegistry();
  if (reg) return { source: "registry", key: reg };
  const rc = readRc(rcPath);
  if (rc) return { source: "rc", key: rc };
  return { source: "none", key: null };
}

export function maskKey(key) {
  const k = String(key ?? "");
  if (k.length < 5) return "***";
  return `${k.slice(0, 2)}***${k.slice(-2)}`;
}

export function writeRc(rcPath, key) {
  if (existsSync(rcPath)) copyFileSync(rcPath, rcPath + ".bak");
  writeFileSync(rcPath, `TYPESAFE_API_KEY="${key}"\n`);
}

export async function verifyKey(key, cfg, deps = {}) {
  try {
    await askTypeSafe({}, cfg, { apiKey: key, post: deps.post });
    return { ok: true };
  } catch (e) {
    if (e instanceof AgentGuardError) return { ok: false, type: e.type };
    return { ok: false, type: "unknown" };
  }
}
