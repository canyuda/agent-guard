import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths, ensureUserConfig } from "../lib/paths.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "ag-"));

test("解析链:env AGENT_GUARD_CONFIG 最高优先", () => {
  const home = tmp(), pkg = tmp();
  const envCfg = join(home, "my.json");
  writeFileSync(envCfg, "{}");
  const p = resolvePaths({ home, env: { AGENT_GUARD_CONFIG: envCfg }, pkgRoot: pkg });
  assert.equal(p.configPath, envCfg);
});

test("默认:用户数据目录,config/rc/cache 落同目录", () => {
  const home = tmp(), pkg = tmp();
  const p = resolvePaths({ home, env: {}, pkgRoot: pkg });
  assert.equal(p.dataDir, join(home, ".agent-guard"));
  assert.equal(p.configPath, join(home, ".agent-guard", "config.json"));
  assert.equal(p.rcPath, join(home, ".agentguardrc"));
  assert.equal(p.cachePath, join(home, ".agent-guard", "cache", "judgments.json"));
});

test("首启复制包内默认;文件已存在就不动(损坏也不覆盖用户数据)", () => {
  const home = tmp(), pkg = tmp();
  writeFileSync(join(pkg, "config.json"), JSON.stringify({ model: "pkg-default" }));
  const p1 = resolvePaths({ home, env: {}, pkgRoot: pkg });
  ensureUserConfig(p1, pkg);
  assert.equal(JSON.parse(readFileSync(p1.configPath, "utf8")).model, "pkg-default");
  writeFileSync(p1.configPath, JSON.stringify({ model: "user-edit" }));
  ensureUserConfig(p1, pkg);
  assert.equal(JSON.parse(readFileSync(p1.configPath, "utf8")).model, "user-edit");
  writeFileSync(p1.configPath, "not-json{{{"); // 损坏:留着给用户修,不用模板静默覆盖
  ensureUserConfig(p1, pkg);
  assert.equal(readFileSync(p1.configPath, "utf8"), "not-json{{{");
});

test("env 指定 config 时不代管(不复制不覆盖)", () => {
  const home = tmp(), pkg = tmp();
  writeFileSync(join(pkg, "config.json"), JSON.stringify({ model: "pkg-default" }));
  const envCfg = join(home, "mine.json");
  writeFileSync(envCfg, JSON.stringify({ model: "mine" }));
  const p = resolvePaths({ home, env: { AGENT_GUARD_CONFIG: envCfg }, pkgRoot: pkg });
  ensureUserConfig(p, pkg);
  assert.equal(JSON.parse(readFileSync(envCfg, "utf8")).model, "mine");
});
