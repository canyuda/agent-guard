# agent-guard

TypeSafe(Jev)驱动的 ZCode 工具调用安全守卫:在 `PreToolUse` 拦截 `Bash`、`Write`、`Edit` 与全部 MCP 工具,用一次快速的结构化判断评估操作的**破坏性风险**与**安全红线**,低风险放行、高风险强制人工确认——即使在"完全访问"模式下也拦得住。

- **零 npm 依赖**:Node 内置 fetch 直连 TypeSafe API,无需安装任何包
- **毫秒级日常开销**:四层快路径(豁免名单→白名单→黑名单→缓存),大部分命令根本不出网
- **fail-closed**:评估服务不可用/超时/未配 key 时一律转人工,绝不静默放行
- **策略在代码、语义在模型**:模型只回答"风险多高",阈值与分级全部在 `config.json` 里可调

## 工作原理

```
ZCode PreToolUse (Bash|Write|Edit|mcp__.*)
  → stdin: { tool_name, tool_input, ... }
  → ① 快路径: MCP 豁免 → 只读白名单 → 破坏黑名单 → 判定缓存   (命中即返回,不出网)
  → ② 灰色地带: 一次请求并行问 Jev 两个问题
       destructive_risk (Score, 0~3 四级: 只读 / 受控修改 / 中度 / 破坏性不可逆)
       policy_violation  (Noul,  是否触碰红线: 强推/抹盘/改系统文件/泄凭证/fork 炸弹…)
  → ③ 三级判定: block(risk≥2.5 或 violation≥0.85)
                 confirm(risk≥1.5 或 violation≥0.5)
                 allow(其余)
  → ④ 输出映射: allow → 放行;block → deny + 说明文案
                 (deny 在任何模式下都强制生效;confirm 默认也用 deny 承载以防
                  ask 被静默放行,本机实测 ask 有确认面后已在 config 切为 false,
                  即 confirm 弹原生确认框)
```

deny 的理由会回流给 agent,文案明确要求它停下向用户说明、等待人工执行,禁止重试或改写命令绕过。

## 前置条件

- Node ≥ 20(本机 `node -v` 确认)
- TypeSafe API key(在 [console.typesafe.ai](https://console.typesafe.ai) 创建)

## 配置 API key(二选一)

```bash
# 方式一:环境变量(Windows 用户级,重启 ZCode 后生效)
setx TYPESAFE_API_KEY "your_api_key"

# 方式二:配置文件(cmd-guard 同款约定,免环境变量继承问题)
echo 'TYPESAFE_API_KEY="your_api_key"' > ~/.agentguardrc
```

key 只进入请求头,不会出现在日志、审计或异常消息中。

## 启用 hook

在工作区配置 `<workspace>/.zcode/config.json`(或用户级 `~/.zcode/cli/config.json`,对所有项目生效)添加:

```json
{
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
}
```

> 注意 `hooks.enabled: true` 必须显式设置(ZCode 配置文件 hook 默认禁用);配置修改后需**完全重启 ZCode** 生效。

## 手动评估(不经过 hook)

```bash
cd agent-guard

# 离线 mock(用 test/fixtures/judgments.json 的固定判定,无需 key)
node check.mjs --mock --cmd "git reset --hard HEAD~1"
# → level=confirm rendered=deny source=api risk=2.3 violation=0.4 (6ms)

# 真实评估单条命令
node check.mjs --cmd "docker compose down"

# 评估文件写入
node check.mjs --tool Write --input '{"file_path":"/etc/sudoers","content":"root ALL=(ALL) ALL"}'
```

## 配置(config.json)

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `model` | `jev-latest` | 模型,可锁具体版本 |
| `degrade_ask_to_deny` | `false`(试点期) | confirm 级是否用 deny 承载;默认 `true`,实测本机完全访问模式 ask 有确认面后已切 `false`,异常场景可随时切回 |
| `thresholds.*` | `2.5/0.85`(block)、`1.5/0.5`(confirm) | 三级判定阈值,risk 为 0~3 连续值 |
| `fastpath.mcp_allowlist` | `[]` | MCP server 豁免名单(命中直接放行),按审计数据填 |
| `fastpath.allowlist` | git 只读、ls/cat/echo 等 15 条 | 只读白名单正则(命中放行,不出网) |
| `fastpath.denylist` | `rm -rf`、`format`、fork 炸弹、force push | 破坏黑名单正则(命中直接按 block 处理) |
| `cache.ttl_minutes` / `max_entries` | `60` / `500` | 判定缓存(同一命令 1 小时内不重跑推理) |
| `log.enabled` / `path` | `true` / `logs/audit.jsonl` | 审计日志 |

调阈值不需要动代码或问题文案——缓存存的是原始概率,阈值改动即时生效。

## 审计日志

`logs/audit.jsonl` 逐行记录每次判定:`ts`、`tool`、命令/路径摘要(≤200 字符)、`source`(fastpath_*/cache/api/error)、`risk` 与概率分布、`violation`、`level`、实际渲染的决策、`reason`、耗时。调阈值、回溯误判、填 MCP 豁免名单都以此为准。

```bash
tail -5 logs/audit.jsonl
```

## 测试与项目结构

```bash
npm test          # 42 个测试(config/state/fastpath/decide/emit/typesafe/judge/hook 集成/样例集)
```

```
agent-guard/
  hook.mjs        # PreToolUse 入口(stdin→判定→stdout,异常兜底 fail-closed)
  check.mjs       # 手动评估 CLI(--cmd / --tool+--input / --mock)
  probe.mjs       # hook 契约探针(开发期验证 ZCode 行为用)
  lib/            # config / state / fastpath / decide / emit / typesafe / judge / log
  config.json     # 全部策略配置
  test/           # node:test 单测 + 集成测试 + fixtures + §10 十二条样例集
  docs/specs/     # 设计 spec(v2)
  docs/plans/     # 实施计划
```

## 当前状态与路线

- ✅ 全部组件实现,42/42 测试通过,真实 API 冒烟通过
- ✅ 契约实测(2026-09-20):完全访问模式 `ask` 弹原生确认框、`deny` 硬拦截且理由回流 agent;`degrade_ask_to_deny` 已切 `false`,详见 [docs/notes/2026-09-20-contract-findings.md](docs/notes/2026-09-20-contract-findings.md)
- 🔄 **试点中**:工作区级挂载正式 hook,2-3 天观察期;退出标准(spec §9b):零崩溃、零高危误放、误伤率 <10%、依据审计填出 MCP 豁免名单 → 达标后迁移 `~/.zcode/cli/config.json` 全局启用

设计与决策细节见 [docs/specs/2026-09-20-agent-guard-design.md](docs/specs/2026-09-20-agent-guard-design.md),实施过程见 [docs/plans/2026-09-20-agent-guard.md](docs/plans/2026-09-20-agent-guard.md)。
