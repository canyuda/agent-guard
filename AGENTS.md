# AGENTS.md — agent-guard 工作区须知

## 仓库定位

`@canyuda/agent-guard`：TypeSafe(Jev) 驱动的 AI 编程 Agent 工具调用安全守卫。通过宿主工具（ZCode / Claude Code / Cursor）的 PreToolUse hook 拦截 `Bash|Write|Edit|mcp__.*`，三级判定 allow/confirm/block。**产品是通用 Agent 安全守卫，不是 ZCode 专属**——文档与文案表述必须通用化。

## 技术约束（硬性）

- Node ≥ 20，纯 ESM（`.mjs`），**零 npm 依赖是产品特性**——不要引入任何依赖；HTTP CONNECT 代理用 `lib/typesafe.mjs` 自实现（Node 内置 fetch 不读 `HTTP(S)_PROXY` 环境变量）。
- fail-closed 语义不可破坏：API 超时/网络错/未配 key 一律转人工（confirm/block），绝不静默放行。
- 无 lint/typecheck，唯一门禁是 `npm test`（CI 跑 node 20/22 矩阵）。
- key（TYPESAFE_API_KEY）只存 `~/.agentguardrc`，永不进日志、审计、异常消息或 npm 包。

## 常用命令

```bash
npm test                                # node:test 全量（74 个）
node check.mjs --mock --cmd "git reset --hard HEAD~1"   # 离线评估（test/fixtures 固定判定，不出网）
node check.mjs --cmd "docker compose down"              # 真实 API 评估
node bin/agent-guard.mjs --help         # bin 冒烟
```

注意：test script 是裸 `node --test`，**不要加测试文件路径参数**——node 20 不支持 glob 参数。

## 结构与分层

```
hook.mjs / check.mjs        # 薄入口，逻辑在 lib/
bin/agent-guard.mjs → lib/cli.mjs      # CLI（setup / check / hook 子命令）
lib/run-hook.mjs            # hook 管道：stdin → judge → render → audit，异常兜底 fail-closed
lib/judge.mjs               # 编排：state → fastpath → cache → API → decide
lib/{config,paths}.mjs      # 配置与数据目录（env > ~/.agent-guard/ > 包内模板）
lib/{fastpath,decide,emit,state,typesafe,log}.mjs
lib/{run-check,setup-hooks,setup-key}.mjs   # check 子命令 / setup 的 hook 挂载与 key 探测
config.json                 # 包内策略模板（阈值/白黑名单/缓存/proxy）
docs/specs/ docs/plans/ docs/notes/ docs/release.md
```

- 判定语义：block（risk≥2.5 或 violation≥0.85）/ confirm（≥1.5/0.5）/ allow；阈值全在 config.json，缓存存原始概率，改阈值即时生效、无需清缓存。
- **运行时数据目录是 `~/.agent-guard/`**（config/cache/logs）；仓库内 config.json、logs/ 只是模板与开发期旧位置。排查实际行为先看 `~/.agent-guard/logs/audit.jsonl`。

## 文案与审计约定

- 面向用户的提示文案用中文「破坏性风险 / 红线违反」百分比形式；审计 JSON 字段保持英文（risk/violation/level/source…）。

## 工作方式（Karpathy 准则 + Ponytail）

- **先想后写**：动手前明确假设；有多种解释就摆出来，不默默选一个；有更简单的做法就说，该反驳就反驳。
- **简单优先、删优于增、无聊优于聪明**：只写解决问题的最小代码，不做超出要求的功能、单次使用的抽象、没人要的「灵活性」；200 行能写成 50 行就重写。最短可用 diff 优先——但必须先读懂问题、追踪完整调用链；bug 修根因不修症状（在所有调用方经过的公共处修一次）。
- **外科手术式修改**：只动必须动的；不顺手「改进」邻近代码/注释/格式；跟随现有风格；发现无关死代码提一句但不删；自己的改动产生的孤儿（无用 import/变量）要清掉。每一行改动都能追溯到需求。
- **目标驱动**：任务先转成可验证目标（写复现测试→修到通过；重构→前后测试都过），多步任务列计划+每步验证点，自己循环到验证通过。
- **Ponytail 阶梯**（够用就停在最上面一级）：不需要存在 → 仓库里已有 → 标准库 → 平台原生特性 → 已装依赖 → 一行 → 最小可用代码。
- 故意留下的简化（有明确上限的）用 `ponytail:` 注释标明上限与升级路径；非平凡逻辑留一个最小可运行检查；输出代码在前、解释最多三行（跳过了什么、什么时候加），用户明确要的报告/走查除外。

## 本工作区特有 gotchas

- 本工作区 `.zcode/config.json` 挂载了仓库内 `hook.mjs`（试点）——**在这个仓库里干活，自己的 Bash/Write/Edit 也会被它拦**：confirm 级弹原生确认框、黑名单命中直接 block，均属正常现象，不是环境故障。
- `degrade_ask_to_deny` 本机已切 `false`（confirm 直通原生确认框）；改动前先读 `docs/notes/2026-09-24-consent-deadlock.md` 了解决策时间线。
- 本机网络外网直连不稳，代理 `127.0.0.1:7890`（`~/.agent-guard/config.json` 的 proxy 段）；网络报错先查代理再怀疑代码。
- 并行会话常见：文件可能被同时修改，**编辑前重读**；不代用户 commit/push。
- 发布走 tag 触发 CI 自动 publish：`npm version patch|minor|major` → `git push --follow-tags origin master`。tag 推上远端后**不要手动 `npm publish` 同一版本**。发版检查清单见 `docs/release.md`。

## 改敏感区前先读

- `docs/specs/2026-09-20-agent-guard-design.md` — 设计总纲（判定/缓存/快路径语义）
- `docs/notes/2026-09-20-contract-findings.md` — 宿主 hook 契约实测（ask/deny 行为）
- `docs/release.md` — 发布流程与包内容检查
