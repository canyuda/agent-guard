# agent-guard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 TypeSafe(Jev)驱动的 ZCode PreToolUse 安全守卫:拦截 Bash/Write/Edit/MCP,三级判定(allow/confirm/block),完全访问模式下可靠地强制人工确认。

**Architecture:** 单目录 Node ESM 项目,hook 进程读 stdin JSON → 构造 state → 四层快路径(MCP豁免/白名单/黑名单/缓存)→ 灰色地带调 TypeSafe API(两问并行)→ 三级判定 → 输出映射层渲染为 ZCode permissionDecision。编排逻辑收在 `lib/judge.mjs`,`hook.mjs` 与 `check.mjs` 共用。

**Tech Stack:** Node ≥20(本机 24.19.0),零运行时依赖(**内置 fetch 直连,spec §11 路径 B 转正**——hook 需要"8 秒超时+零重试"精确控制,且免去用户亲自 npm install;SDK 留作 check 手动模式的后续可选升级),测试用内置 `node:test`。

**Spec:** `docs/specs/2026-09-20-agent-guard-design.md`(v2,commit dcecdc2)

## Global Constraints

- Node ESM:所有源码 `.mjs`,`package.json` 含 `"type": "module"`;**零 npm 依赖**
- API:`POST https://api.typesafe.ai/v1/systemone`,`Authorization: Bearer <key>`,直连不走代理;单次请求超时 **8000ms,hook 路径零重试**;hook 整体 `timeoutMs: 15000`
- API key 只从 `TYPESAFE_API_KEY` 环境变量或 `~/.agentguardrc` 读取,**绝不写入日志/审计/异常消息**
- 阈值与名单全部在 `config.json`,代码不含硬编码策略值
- 阈值(Score 为 0~3 连续值):block `risk≥2.5 或 violation≥0.85`;confirm `risk≥1.5 或 violation≥0.5`;`degrade_ask_to_deny` 默认 `true`
- confirm/block 经 deny 承载的 reason 固定模板(spec §5);审计 `input_digest` 只存前 200 字符
- Windows:配置内路径一律正斜杠;测试命令在 Git Bash 下运行
- TDD:每步红→绿→提交;测试跑法 `node --test <file>`
- 涉及安装/重启 ZCode/切换权限模式的步骤,一律**生成命令或说明交用户执行**,工程师不代办

---

### Task 1: 探针——实测 ZCode hook 契约(spec §13 项 1-3)

**Files:**
- Create: `probe.mjs`(项目根,临时保留)
- Create: `C:/Users/epsoft-bc/.zcode/workspace/default/.zcode/config.json`(工作区 hooks,试点配置复用)
- Create: `docs/notes/2026-09-20-contract-findings.md`

**Interfaces:**
- Produces: 契约结论——(a) stdin 输入字段名(预计 `hook_event_name`/`tool_name`/`tool_input`);(b) stdout 输出 JSON 的确切 schema(预计 Claude 形态 `hookSpecificOutput.permissionDecision`);(c) **完全访问模式下 `ask` 是否有确认面**(决定 `degrade_ask_to_deny` 去留)。Task 6/8 按此结论实现,不符只需改 `emit.mjs` 的 `buildOutput` 常量。

- [ ] **Step 1: 写探针脚本**

```js
// probe.mjs — 契约探针:转储 stdin,按 probe-decision.txt 渲染决策
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
```

- [ ] **Step 2: 本地自测三种决策**

```bash
cd /c/Users/epsoft-bc/.zcode/workspace/default/agent-guard
for d in allow ask deny; do echo $d > probe-decision.txt; echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node probe.mjs; echo; done
```
Expected: 三行 JSON,`permissionDecision` 分别为 allow/ask/deny。

- [ ] **Step 3: 写工作区 hooks 配置(探针版)** → `C:/Users/epsoft-bc/.zcode/workspace/default/.zcode/config.json`:

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PreToolUse": [
        {
          "matcher": "Bash|Write|Edit|mcp__.*",
          "hooks": [
            { "type": "process", "command": "node", "args": ["C:/Users/epsoft-bc/.zcode/workspace/default/agent-guard/probe.mjs"], "timeoutMs": 15000 }
          ]
        }
      ]
    }
  }
}
```

- [ ] **Step 4: 用户配合验证(完全访问模式)**:先置 `probe-decision.txt` 为 allow,用户完全重启 ZCode,完全访问模式下触发 Bash 命令;再依次改 ask/deny 各触发一次,观察弹框/拦截/静默放行并记录。

- [ ] **Step 5: 读 probe-dump.json 真实字段名,结论写入 findings(预期→实测→采纳值)**
- [ ] **Step 6: 工作区 `hooks.enabled` 改回 false(试点时再开)**
- [ ] **Step 7: Commit** `git add probe.mjs probe-decision.txt docs/notes/ && git commit -m "chore: hook 契约探针与实测结论"`

---

### Task 2: 脚手架与配置加载(lib/config.mjs)+ spec 修订

**Files:** Create `package.json`,`config.json`,`lib/config.mjs`;Test `test/config.test.mjs`;Modify spec §11/§3/§13

**Interfaces:**
- Produces: `PROJECT_ROOT`;`loadConfig(path?)`(DEFAULTS←文件深合并,`AGENT_GUARD_CONFIG` 可覆写路径);`resolveApiKey(env?, rcPath?)`(env `TYPESAFE_API_KEY` → `~/.agentguardrc` → null)。DEFAULTS:

```json
{
  "model": "jev-latest",
  "degrade_ask_to_deny": true,
  "thresholds": { "block_risk": 2.5, "block_violation": 0.85, "confirm_risk": 1.5, "confirm_violation": 0.5 },
  "fastpath": { "mcp_allowlist": [], "allowlist": ["^git (status|diff|log|show)\\b", "^git rev-parse\\b", "^(ls|pwd|cat|head|tail|wc|which|where|whoami|date|echo)\\b", "^node --version\\b", "^npm (ls|--version|view)\\b", "^python --version\\b", "^rg\\b", "^grep\\b"], "denylist": ["\\brm\\s+[^|;&]*-[a-zA-Z]*r", "^format\\b", ":\\(\\)\\{.*&.*\\};:", "git push[^|;&]*--force"] },
  "cache": { "ttl_minutes": 60, "max_entries": 500 },
  "log": { "enabled": true, "path": "logs/audit.jsonl" },
  "state": { "content_prefix_bytes": 2048 }
}
```

- [ ] **Step 1: 写失败测试**

```js
// test/config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveApiKey } from "../lib/config.mjs";

test("config 缺失时返回默认值", () => {
  const cfg = loadConfig(join(mkdtempSync(join(tmpdir(), "ag-")), "none.json"));
  assert.equal(cfg.model, "jev-latest");
  assert.equal(cfg.degrade_ask_to_deny, true);
  assert.equal(cfg.thresholds.block_risk, 2.5);
});

test("config 文件覆盖默认值(深度合并)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const p = join(dir, "c.json");
  writeFileSync(p, JSON.stringify({ thresholds: { block_risk: 2.0 } }));
  const cfg = loadConfig(p);
  assert.equal(cfg.thresholds.block_risk, 2.0);
  assert.equal(cfg.thresholds.confirm_risk, 1.5);
});

test("API key 解析顺序 env > rc > null", () => {
  const dir = mkdtempSync(join(tmpdir(), "ag-"));
  const rc = join(dir, "rc");
  writeFileSync(rc, 'OTHER=1\nTYPESAFE_API_KEY="sk-123"\n');
  assert.equal(resolveApiKey({ TYPESAFE_API_KEY: "sk-env" }, rc), "sk-env");
  assert.equal(resolveApiKey({}, rc), "sk-123");
  assert.equal(resolveApiKey({}, join(dir, "none")), null);
});
```

- [ ] **Step 2: 跑测试确认失败**  Run: `node --test test/config.test.mjs`  Expected: FAIL(模块不存在)
- [ ] **Step 3: 实现 package.json(`{"name":"agent-guard","version":"0.1.0","private":true,"type":"module"}`)、config.json(=DEFAULTS+名单初值)、lib/config.mjs**(deepMerge/PROJECT_ROOT/loadConfig/resolveApiKey,见 DEFAULTS 块)
- [ ] **Step 4: 跑测试确认通过**  Expected: 3 PASS
- [ ] **Step 5: 修订 spec**:§11 零依赖直连转正(SDK 降为 check 可选升级);§3 组件表补 `lib/judge.mjs`;§13 删第 4 项
- [ ] **Step 6: Commit** `git commit -m "feat: 配置加载与 key 解析(TDD);spec 传输层转正为零依赖直连"`

---

### Task 3: state 构造(lib/state.mjs)

**Files:** Create `lib/state.mjs`;Test `test/state.test.mjs`
**Produces:** `buildState(toolName, toolInput, cfg)`——Bash→`{tool,command,cwd}`;Write/Edit/ApplyPatch→`{tool,file_path,content_prefix}`(截 `cfg.state.content_prefix_bytes`,content??new_string);`mcp__*`→`{tool,server,arguments}`(键排序序列化后截断);其他→`{tool,arguments}`

- [ ] **Step 1: 失败测试**(Bash 提取/截断恰好 N 字节/Edit 兜底/MCP 解析 server/未知工具兜底,5 例)
- [ ] **Step 2: 红** → **Step 3: 实现**(prefix=String().slice(0,cap);stable=JSON.stringify(o,sorted keys) 截断)→ **Step 4: 绿(5 PASS)** → **Step 5: Commit**

---

### Task 4: 快路径(lib/fastpath.mjs)

**Files:** Create `lib/fastpath.mjs`;Test `test/fastpath.test.mjs`
**Produces:**
- `matchFast(toolName, toolInput, cfg)→{hit,level?,source?}`(mcp_allowlist→allow/fastpath_mcp;仅 Bash 命令串过 allowlist→allow、denylist→block;其余 hit:false)
- `cacheKey(toolName, toolInput)→sha1`(Bash trim;file 工具 file_path+内容;其他稳定序列化)
- `cacheLookup(cachePath,key,now?)→{risk,violation}|null`;`cacheStore(cachePath,key,judgments,cfg,now?)`(TTL=now+ttl_minutes*60_000,过期即 miss;按 expires 排序淘汰至 max_entries;损坏按空)

- [ ] **Step 1: 失败测试**(MCP 豁免命中/未命中、白名单 git status+echo、黑名单 rm -rf+force push、灰色与文件工具不命中、缓存 TTL 边界±1ms+LRU 逐最旧、cacheKey trim 稳定)
- [ ] **Step 2: 红** → **Step 3: 实现** → **Step 4: 绿** → **Step 5: Commit** `feat: 四层快路径之名单与判定缓存(TTL+LRU)`

---

### Task 5: 三级判定(lib/decide.mjs)

**Produces:** `decide({risk,violation},cfg)→{level,reason}`,reason=`risk=X.XX violation=X.XX`
- [ ] **Step 1: 失败测试**:边界 1.49→allow、1.5→confirm、2.5→block、0.49/0.5/0.85 violation 三档、reason 格式
- [ ] **Step 2: 红** → **Step 3: 实现**(阈值比较纯函数)→ **Step 4: 绿(2 PASS)** → **Step 5: Commit**

---

### Task 6: 输出渲染(lib/emit.mjs)

**Produces:** `render(level,reason,cfg)→{stdout}`;schema 集中 `buildOutput(decision,reason)`(Claude 形态 hookSpecificOutput.permissionDecision/Reason,hookEventName "PreToolUse");allow→allow;confirm&&!degrade→ask;confirm(degrade)/block→deny+模板:`[agent-guard] 需人工确认/高危禁止(<reason>)。此操作需人工确认后才可执行:请停下向用户说明,等待用户自行执行或明确同意;不要重试、不要改写命令规避本拦截。`
- [ ] **Step 1: 失败测试**:allow 渲染;degrade 默认 confirm+block 均 deny 且文案含 需人工确认+不要重试;degrade=false 时 confirm→ask、block→deny
- [ ] **Step 2: 红** → **Step 3: 实现** → **Step 4: 绿(3 PASS)** → **Step 5: Commit**

---

### Task 7: TypeSafe API 封装(lib/typesafe.mjs)

**Produces:** `askTypeSafe(state,cfg,deps?)→{risk,risk_probabilities,violation}`;`deps={post?,apiKey?}`(apiKey 显式 null=无 key);`AgentGuardError(type,message)`,type∈{no_key,timeout,network,auth,service,bad_schema,unknown};QUESTIONS 常量=spec §4 两问(Score 四级+Noul 红线);defaultPost:AbortController 8s、fetch POST、Bearer、!ok 抛带 status 的 Error;classify:AbortError→timeout、TypeError→network、401/403→auth、≥400→service、其余 unknown
- [ ] **Step 1: 失败测试**(成功取值/no_key/五类错误分类,post 全注入)
- [ ] **Step 2: 红** → **Step 3: 实现** → **Step 4: 绿(5 PASS)**
- [ ] **Step 5: 可选真实冒烟**(直连):`node -e "import('./lib/typesafe.mjs').then(async m=>{console.log(JSON.stringify(await m.askTypeSafe({tool:'Bash',command:'docker compose down',cwd:'/tmp'},{model:'jev-latest'}))})"`
- [ ] **Step 6: Commit** `feat: TypeSafe systemone 零依赖封装(8s 超时/零重试/错误分类)`

---

### Task 8: 编排+审计+入口(lib/judge.mjs、lib/log.mjs、hook.mjs)

**Produces:**
- `judge(toolName,toolInput,cfg,deps={ask?})→{level,reason,source,judgments|null,duration_ms,state}`;source∈fastpath_allow|fastpath_block|fastpath_mcp|cache|api|error;快路径 reason:allow="只读白名单/豁免命中"、block="黑名单命中:明确破坏性命令";缓存存原始 {risk,violation} 阈值现算;ask 抛错→confirm+source=error+reason=`评估服务不可用(<type>),按 fail-closed 转人工`;缓存路径 `cfg.__cachePath`(生产 `<ROOT>/.cache/judgments.json`)
- `appendAudit(entry,cfg)`:JSONL;字段 ts/tool/input_digest(≤200)/source/risk/risk_probabilities/violation/level/rendered/reason/duration_ms;`cfg.log.path` 绝对路径直用,否则 join(PROJECT_ROOT)
- hook.mjs:readStdin→JSON.parse→judge→render→stdout+审计;digest=command??file_path??JSON.stringify(toolInput);解析/内部异常→顶层 catch 渲染 confirm("agent-guard 内部错误(<ErrorName>)")+审计,退出 0;渲染失败→exit 3;测试缝 `AGENT_GUARD_CONFIG`/`AGENT_GUARD_MOCK_JSON`(stub ask)
- [ ] **Step 1: judge 失败测试**(白名单不出网 ask 抛 9 也 allow/api 写缓存二次 cache 级不变/AgentGuardError→confirm+error)
- [ ] **Step 2: 红** → **Step 3: 实现 judge+log** → **Step 4: 绿(3 PASS)**
- [ ] **Step 5: hook 集成测试(spawn)**:confirm 样例 mock risk=2.0→stdout deny+退出 0+审计行 level/rendered;stdin 非法 JSON→deny 渲染+退出 0
- [ ] **Step 6: 红** → **Step 7: 实现 hook.mjs** → **Step 8: `node --test test/` 全绿** → **Step 9: Commit** `feat: 编排层/审计/PreToolUse 入口(fail-closed 兜底)`

---

### Task 9: 手动 CLI + 样例集(check.mjs、fixtures、sample-set)

**Files:** Create `check.mjs`,`test/fixtures/judgments.json`,`test/sample-set.test.mjs`
- [ ] **Step 1: fixtures**:`{"npm install lodash":{1.0,0.02},"src/Main.java":{1.1,0.01},"git reset --hard HEAD~1":{2.3,0.4},"docker compose down":{2.0,0.1},"taskkill /F /IM java.exe":{2.1,0.05},"/etc/sudoers":{2.8,0.93}}`
- [ ] **Step 2: 样例集测试**:十二条(见 spec §10)断言 level+渲染(allow→allow,其余→deny);此时 judge 已实现,全绿即回归基线,红则修映射/名单
- [ ] **Step 3: 实现 check.mjs**:`--cmd`/`--tool X --input <json>`/`--mock`(fixtures 缺条目报错);输出 `level=… rendered=… source=… risk=… violation=… (Nms)`+state 行
- [ ] **Step 4: 全量测试+CLI 冒烟** `node check.mjs --mock --cmd "git reset --hard HEAD~1"` → `level=confirm rendered=deny source=api risk=2.3 violation=0.4`
- [ ] **Step 5: Commit** `feat: check CLI 与 §10 十二条样例集(mock fixtures)`

---

### Task 10: 试点部署与验收(spec §9b)

- [ ] **Step 1: 独立冒烟**:管道喂 hook(git status→allow;git branch→灰色真实 API);tail 审计
- [ ] **Step 2: 工作区 hooks 指向 hook.mjs**(T1 验证过的形态,enabled:true)
- [ ] **Step 3: 用户配合上线**:重启 ZCode(完全访问),跑三条 `echo pilot-ok`(放行)/`tar --version`(真实 API)/`rm -rf ./no-such-dir/`(拦截);核对文案与审计
- [ ] **Step 4: `docs/notes/2026-09-20-pilot-start.md`**:冒烟实录+§9b 五条退出标准清单;试点 2-3 天,达标迁全局
- [ ] **Step 5: Commit** `chore: 试点上线记录与验收清单`

---

## Self-Review 结论(已执行)

- 覆盖:spec §3 组件全部有任务;§4→T7;§5→T5+T6;§6→T4;§7→T2+T10;§8→T7+T8;§9→T8;§9b→T10;§10→T9;§13→T1(SDK 项随零依赖取消,T2 修订 spec)
- 类型一致:judgments={risk,violation} 贯穿 decide/cache/fixtures;judge 返回 {level,reason} 被 emit 消费
- 无占位符;用户执行步骤显式标注(T1 Step4、T10 Step3);无 npm install(零依赖)
