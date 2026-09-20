# agent-guard 设计文档

- 日期:2026-09-20
- 状态:v2(grilling 两轮拷问后修订),待实施
- 项目位置:`C:\Users\epsoft-bc\.zcode\workspace\default\agent-guard\`
- 修订:v2 新增输出映射层(§5)、试点计划(§9b)、决策记录与风险更新;v1 为首轮设计

## 1. 目标

为 ZCode 提供一层工具调用安全守卫:在 `PreToolUse` 事件拦截 `Bash`、`Write`、`Edit` 及全部 MCP 工具(`mcp__.*`),用 TypeSafe System One 模型(Jev)判断操作的破坏性风险与安全红线违规。判定分三级:**allow**(放行)/ **confirm**(需人工确认)/ **block**(禁止);由输出映射层决定每级在 ZCode 里用什么决策承载(§5)。用户日常以**完全访问模式**运行 ZCode,本守卫是该模式下唯一的语义闸门。

### 非目标

- 不拦截网络外发类内置工具(WebFetch/WebSearch)——聚焦本地破坏性操作;外发风险属隐私合规,判断维度不同,硬并入会稀释判断质量
- 只处理 `PreToolUse`,不覆盖其余六个 hook 事件
- 不替代 ZCode 自身权限系统
- 不做服务端部署、多用户、UI

## 2. 背景与先例

- **cmd-guard**(PyPI `cmd-guard`,源码 github.com/NieXi/agent-guard):Claude Code 上的同类实现,Python + TypeSafe,三问(risk Score / violation Noul / decision Choice),fail-closed,`~/.agentguardrc` 约定与 `--mock` 模式可借鉴;不采用"模型直接选 decision"。
- **关键先例事实(Claude Code,ZCode 待实测)**:官方文档确认 hook 的 `deny` 在**任何权限模式下都强制拦截**;但 GitHub issue #77212 报告 **bypassPermissions(完全访问)模式下 `ask` 会被静默自动放行**(与 cmd-guard 声称的"ask 自动转拒绝"相矛盾,版本行为有分歧)。结论:完全访问模式下唯一可靠的闸门是 `deny`——这是 §5 输出映射层存在的原因。
- **ZCode hook 机制**(zcode-guide:diagnosing-hooks / configuration-guide):
  - 用户级 `~/.zcode/cli/config.json`、工作区级 `<workspace>/.zcode/config.json`(或 `zcode.json`),顶层 `hooks` 键:`{ enabled, timeoutMs?, maxOutputBytes?, events: { <Event>: [...] } }`;**必须显式 `hooks.enabled: true`**
  - matcher 是对工具名的大小写敏感正则,别名 `Write`/`Edit` ← `ApplyPatch`、`Task` ↔ `Agent`
  - `type: "process"`:可执行文件 + `args[]`,不经 shell,Windows 首选
  - stdout 严格 JSON schema(多余 key 校验失败);退出码 0 放行、2 拦截;`PreToolUse` 可返回 `allow`/`ask`/`deny`

## 3. 总体架构与数据流

```
ZCode PreToolUse (matcher: Bash|Write|Edit|mcp__.*)
  → stdin: { hook_event_name, tool_name, tool_input, ... }   ← 字段名待实测验证(§13)
  → hook.mjs
      1. lib/state.mjs     按工具构造 state(命令/文件/参数,截断)
      2. lib/fastpath.mjs  白名单/MCP豁免→allow;黑名单→高危;缓存命中→复用
      3. lib/typesafe.mjs  灰色地带调 API:两问并行,单次请求
      4. lib/decide.mjs    概率 → allow/confirm/block 三级 + reason(纯函数)
      5. lib/emit.mjs      三级 → ZCode 决策渲染(依 config 的 degrade 设置)
      6. lib/log.mjs       JSONL 审计
  → ZCode:放行 / 原生确认框 / 拦截+理由回流给 agent
```

组件职责:

| 组件 | 职责 | 依赖 |
| --- | --- | --- |
| `hook.mjs` | 入口:读 stdin、编排 1-6、写 stdout/退出码;顶层兜底捕获 | 全部 lib |
| `check.mjs` | 手动 CLI:`--cmd` / `--tool`+`--input` / `--mock`,不经 hook 管道直接看判定 | state/fastpath/typesafe/decide |
| `lib/state.mjs` | 从 `tool_name` + `tool_input` 构造 TypeSafe state | 无 |
| `lib/fastpath.mjs` | 白/黑/MCP 豁免名单匹配;判定缓存读写 | config |
| `lib/typesafe.mjs` | API 调用封装:超时、错误分类(hook 路径禁用自动重试) | SDK |
| `lib/decide.mjs` | Score/Noul 概率 → 三级判定纯函数 | config |
| `lib/emit.mjs` | 三级 → ZCode `permissionDecision`/退出码渲染 | config |
| `lib/config.mjs` | 加载 `config.json`;解析 API key(env → `~/.agentguardrc`) | 无 |
| `lib/log.mjs` | JSONL 审计追加写 | config |
| `config.json` | 阈值、名单、映射开关、缓存、日志开关、模型 | — |

## 4. 判断设计

单次请求、两个问题并行(TypeSafe:独立判断同 state 合并请求,省往返):

**`destructive_risk` — Score,四级阶梯:**

| 级 | 含义 |
| --- | --- |
| 0 | 纯只读,无副作用(查看、搜索、查询版本) |
| 1 | 受控、可逆的常规修改(编辑项目文件、装依赖、常规构建) |
| 2 | 影响服务运行或中度风险(重启/停服务、杀进程、批量文件变动、修改 git 历史) |
| 3 | 破坏性、不可逆(删除未提交数据、格式化磁盘、强制推送覆盖远端) |

**`policy_violation` — Noul,单条红线判断:** 该操作是否触碰安全红线:强推覆盖远端、格式化/抹盘、篡改系统文件(sudoers/注册表/服务配置)、泄露或导出凭证密钥、fork 炸弹等资源耗尽、删除备份或不可恢复数据。criteria 分别给出 true/false 的具体描述。

**state 构造(命名 JSON 字段,给足上下文):**

| 工具 | state 字段 |
| --- | --- |
| Bash | `tool`, `command`, `cwd` |
| Write / Edit | `tool`, `file_path`, `content_prefix`(内容前 2KB) |
| mcp__.* | `tool`, `server`(从工具名解析), `arguments`(参数 JSON,截断 2KB) |

问题文案(instructions/criteria)在实施时以本节描述为准起草初版,可随审计数据迭代。

## 5. 决策映射与输出渲染(策略留在代码,承载可切换)

与 cmd-guard 的关键分歧:不让模型直接选决策,只问风险事实;映射规则写在代码里(改阈值/调分级不用动问题语义,缓存可跨阈值复用,误判可回溯)。

**第一层:概率 → 三级(`lib/decide.mjs`,阈值 config 可调,Score 为概率加权连续值 0~3):**

```
若 risk ≥ 2.5 或 violation ≥ 0.85   → block
否则若 risk ≥ 1.5 或 violation ≥ 0.5 → confirm
否则                                → allow
```

**第二层:三级 → ZCode 决策(`lib/emit.mjs`):**

| 级 | `degrade_ask_to_deny: false` | `degrade_ask_to_deny: true`(默认) |
| --- | --- | --- |
| allow | `permissionDecision: "allow"` | 同左 |
| confirm | `permissionDecision: "ask"` | **`permissionDecision: "deny"`** + reason(见下) |
| block | `permissionDecision: "deny"` | 同左 |

`degrade_ask_to_deny` 默认 `true`:按 Claude Code #77212 的最坏情况设计——完全访问模式下 `ask` 可能被静默放行,`deny` 是唯一可靠闸门;deny 的 reason 会回流给 agent,实现"强制人工介入"。day-1 实测 ZCode 行为(§13):若完全访问模式下 `ask` 有确认面,改 config 为 `false` 换流畅体验;一个开关切换,不动代码。

**confirm/block 经 deny 承载时的 reason 文案**(固定模板):`[agent-guard] <风险摘要(risk 级/violation 概率/命中理由)>。此操作需人工确认后才可执行:请停下向用户说明,等待用户自行执行或明确同意;不要重试、不要改写命令规避本拦截。`——防止 agent 收到 deny 后自行"绕路"。

## 6. 快路径(控延迟与费用)

四层漏斗,大部分调用不触碰 API:

1. **MCP 豁免列表**(config: `fastpath.mcp_allowlist`,**初始为空**,试点后按审计数据填):命中 server 直接 allow,审计标 `source: fastpath_mcp`
2. **白名单正则**(config: `fastpath.allowlist`):明确只读 → 直接 allow。初始清单约 15 条,原则:**默认只读、含删除/写入变体的命令不入表**:
   `^git (status|diff|log|show)\b`、`^git rev-parse\b`、`^(ls|pwd|cat|head|tail|wc|which|where|whoami|date|echo)\b`、`^node --version\b`、`^npm (ls|--version|view)\b`、`^python --version\b`、`^rg\b`、`^grep\b`
   (`git branch` 因 `-D` 变体不整条入表;`find` 因 `-delete` 不入;试点期按审计补充)
3. **黑名单正则**(config: `fastpath.denylist`):明确破坏 → 直接走 block 级(经 §5 映射):`rm -rf`、`format`、`:(){ :|:& };:`、`git push --force` 等
4. **判定缓存**:`.cache/judgments.json`,key = `sha1(tool + 归一化输入)`(归一化仅去首尾空白,不做参数级改写以免误判;Bash 用命令串;Write/Edit 用 file_path+content_prefix 哈希,内容变即 miss;MCP 用 server+工具+参数),TTL 60 分钟,上限 500 条 LRU。TypeSafe 文档:证据与问题含义未变无需重跑推理

四层均未命中才调 API。快路径命中同样写审计日志,`source` 区分(`fastpath_allow`/`fastpath_block`/`fastpath_mcp`/`cache`)。

## 7. 配置形态

**试点期挂工作区级**(用户已定):`C:\Users\epsoft-bc\.zcode\workspace\default\.zcode\config.json`,试点达标后迁 `~/.zcode/cli/config.json`(§9b):

```json
"hooks": {
  "enabled": true,
  "events": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit|mcp__.*",
        "hooks": [
          {
            "type": "process",
            "command": "node",
            "args": ["C:/Users/epsoft-bc/.zcode/workspace/default/agent-guard/hook.mjs"],
            "timeoutMs": 15000
          }
        ]
      }
    ]
  }
}
```

**`config.json`(项目内)关键字段:** `model: "jev-latest"`(留字段随时锁版本)、`degrade_ask_to_deny: true`、阈值(`block_risk: 2.5`、`block_violation: 0.85`、`confirm_risk: 1.5`、`confirm_violation: 0.5`)、`fastpath.{mcp_allowlist, allowlist, denylist}`、`cache.{ttl_minutes: 60, max_entries: 500}`、`log.enabled: true`。

**API key 解析顺序:** 环境变量 `TYPESAFE_API_KEY`(用户已配在 Windows 用户注册表,hook 子进程继承 ZCode 进程环境)→ `~/.agentguardrc`(`TYPESAFE_API_KEY="..."`,cmd-guard 同款约定)→ 都没有按失败兜底(§8)。key 只在内存与请求头使用,不写日志、不回显。

**项目布局:**

```
agent-guard/
  package.json            # "type": "module",依赖 @typesafe-ai/sdk
  hook.mjs / check.mjs
  lib/                    # 见 §3 组件表
  config.json
  .cache/judgments.json   # 运行时生成,gitignore
  logs/audit.jsonl        # 运行时生成,gitignore
  test/                   # node:test
  docs/specs/             # 本文档
```

## 8. 失败处理与超时

| 情形 | 行为 |
| --- | --- |
| API 网络失败 / 8 秒超时 / 5xx | confirm 级,reason 注明"评估服务不可用"(经映射层,完全访问下渲染为 deny+说明;服务恢复后自动恢复,接受度在试点观察) |
| Key 缺失 | confirm 级,reason 注明"未配置 API key" |
| 响应解析异常 / schema 不符 | confirm 级,reason 注明原始错误类别 |
| hook 自身异常 | 顶层兜底捕获并尽力输出 confirm/block 级决策;若进程仍崩溃则以非零退出,ZCode 记为失败——两条路都不放行 |
| ZCode 侧超时 | hook `timeoutMs: 15000` 整体兜底 |

原则:**fail-closed → confirm**(用户已定),不静默放行。API 单次请求超时 8 秒且 hook 路径不自动重试(SDK 若无法禁用重试则切换零依赖直连,§11);`check.mjs` 手动模式保留 SDK 默认重试便于诊断。

## 9. 审计日志

`logs/audit.jsonl` 逐行追加,默认开启: `ts`、`tool`、`input_digest`(命令/路径摘要,内容只存前 200 字符)、`source`(api/fastpath_allow/fastpath_block/fastpath_mcp/cache)、`risk`、`risk_probabilities`、`violation`、`level`(allow/confirm/block)、`rendered`(实际输出的 ZCode 决策)、`reason`、`duration_ms`。用途:调阈值有据可依、回溯误判、试点评估数据源。不做滚动,单文件,满了手动清理。

## 9b. 试点计划(用户已定)

- **范围与时长**:先挂当前工作区(default),跑 2-3 天日常使用
- **退出标准(全部达标才迁全局 `~/.zcode/cli/config.json`)**:
  1. 契约验证通过:完全访问模式下 ask/deny 的实际行为与 §5 预设一致(degrade 开关据实测结果定去留)
  2. 零 hook 崩溃/超时(查 ZCode 日志)
  3. 审计中"allow 但人工复核属高危"= 0
  4. 非高危被拦(误伤)率 < 10%,超标先调阈值/白名单再继续试点
  5. MCP 审计数据填出 `mcp_allowlist` 初值
- **迁移动作**:工作区 config 移除 hooks 块 → 全局 config 添加同款

## 10. 测试与调试

- **单元测试(node:test,TDD)**:`decide.mjs` 三级映射边界;`emit.mjs` 两种渲染模式;`fastpath.mjs` 四类名单与缓存淘汰;`state.mjs` 各工具构造与截断;`typesafe.mjs` 桩客户端测错误分类
- **样例集(≥12 条,`--mock` 固定桩值离线跑,期望为三级判定)**:
  `git status`→allow(白名单)、`node --version`→allow、`npm install lodash`→allow(受控)、编辑 `src/Main.java`→allow、`git reset --hard HEAD~1`→confirm(改历史)、`docker compose down`→confirm(停服务)、`taskkill /F /IM java.exe`→confirm(杀进程)、`rm -rf /`→block(黑名单)、`git push --force origin main`→block、写 `/etc/sudoers`→block(violation)、fork 炸弹→block、`echo hi`→allow
- **管道级**:`echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git diff"}}' | node hook.mjs` 验证输出契约与退出码

## 11. 依赖与运行时

- Node ≥ 20(SDK 要求;本机 24.19.0 ✓),`@typesafe-ai/sdk`(npm)
- **备选路径 B(零依赖)**:Node 内置 fetch 直连 `POST https://api.typesafe.ai/v1/systemone`,约 30 行 + 单次重试;SDK 装不上或无法禁用重试/设超时时降级,脚本主体不变
- api.typesafe.ai 本机直连可用(不走代理);npm 安装需走本地代理,安装命令由用户亲自执行
- 成本量级(用户已确认假设):每天 ZCode 内数百次工具调用、灰色地带 <30%、缓存命中后月成本 < $1

## 12. 已定决策(用户,2026-09-20)

**第一轮(brainstorming):**
1. 拦截范围:`Bash|Write|Edit|mcp__.*`(全量)
2. API 失败/超时:fail-closed → confirm(原表 ask)
3. SDK:JavaScript(`@typesafe-ai/sdk`),备选零依赖直连
4. 项目位置:`C:\Users\epsoft-bc\.zcode\workspace\default\agent-guard\`

**第二轮(grilling R1):**
5. 日常权限模式:完全访问——守卫是该模式下唯一语义闸门,白名单做足
6. 试点先行:工作区级挂 2-3 天,达标再全局(§9b)
7. MCP 豁免列表:功能第一期做,初始为空,按审计填
8. WebFetch/WebSearch 不拦(非目标)
9. 模型 `jev-latest`,config 留 `model` 字段随时锁

**第三轮(grilling R2):**
10. 输出映射层:三级判定 + `degrade_ask_to_deny: true` 安全默认(Claude #77212 教训:完全访问下 ask 可能被静默放行,deny 是唯一可靠闸门);day-1 实测后可切
11. 试点退出标准五条(§9b)
12. 白名单初始清单由我起草(§6,约 15 条只读),成本假设 <$1/月

## 13. 实施时需首先验证的风险

1. **完全访问模式下 ZCode 对 hook `ask`/`deny` 的实际行为**(day-1 第一件事,决定 `degrade_ask_to_deny` 去留):样例 hook 分别返回 ask/deny,完全访问模式会话触发 Bash,观察是否弹框/拦截,对照 Claude #77212
2. **ZCode PreToolUse 输出 JSON 的确切 schema**:严格校验下多余 key 即失败;预计同 Claude Code 的 `hookSpecificOutput.permissionDecision` 结构,实测 + 查 ZCode 日志确认。兜底:退出码 0/2 总是可用
3. **ZCode stdin 输入字段名**:预计同 Claude Code(`hook_event_name`/`tool_name`/`tool_input`),实测确认
4. **SDK 重试/超时可配置性**:若无法禁用自动重试,启用 §11 备选路径 B
