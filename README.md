# agent-guard

TypeSafe(Jev)驱动的 AI 编程 Agent 工具调用安全守卫:通过宿主工具(ZCode / Claude Code / Cursor)的 `PreToolUse` hook 拦截 `Bash`、`Write`、`Edit` 与全部 MCP 工具,用一次快速的结构化判断评估操作的**破坏性风险**与**安全红线**,低风险放行、高风险强制人工确认——即使在"完全访问"模式下也拦得住。

- **零 npm 依赖**:Node 内置 fetch 直连 TypeSafe API,无需安装任何包
- **毫秒级日常开销**:四层快路径(豁免名单→白名单→黑名单→缓存),大部分命令根本不出网
- **fail-closed**:评估服务不可用/超时/未配 key 时一律转人工,绝不静默放行
- **策略在代码、语义在模型**:模型只回答"风险多高",阈值与分级全部在 `config.json` 里可调

## 工作原理

```
宿主工具 PreToolUse hook (Bash|Write|Edit|mcp__.*)
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
# 方式一:环境变量(Windows 用户级,重启宿主 AI 编程工具后生效)
setx TYPESAFE_API_KEY "your_api_key"

# 方式二:配置文件(cmd-guard 同款约定,免环境变量继承问题)
echo 'TYPESAFE_API_KEY="your_api_key"' > ~/.agentguardrc
```

key 只进入请求头,不会出现在日志、审计或异常消息中。

## 网络代理(可选)

网络受限、直连 TypeSafe API 不通时,在 `~/.agent-guard/config.json` 打开代理(每次判定现读配置,改动对新触发即时生效,hook 无需重启):

```json
"proxy": { "enabled": true, "host": "127.0.0.1", "port": 7890 }
```

- `host` 填代理 IP 或域名(本机代理用 `127.0.0.1`),`port` 为整数端口
- 零依赖实现 HTTP CONNECT 隧道:Node 内置 fetch **不读** `HTTP(S)_PROXY` 环境变量,代理必须在此显式配置
- fail-closed 语义不变:代理连不上/拒绝隧道/超时一律转人工(error 类型 `network`/`timeout`),开关开了但 host/port 没填对报 `proxy_config`——**不会静默直连绕过代理**

## 安装与一键配置(推荐)

```bash
npm install -g @canyuda/agent-guard
agent-guard setup        # 四步向导:key → 选工具(多选) → 作用域(用户级/项目级) → 确认写入
```

setup 会自动探测 key(env/Windows 注册表/已有 rc 文件)、检测已安装的 ZCode / Claude Code / Cursor,确认后写入对应工具的 PreToolUse hook 配置(自动备份 `.bak`、只增改本项目条目、其余配置原样保留、重复执行幂等)。非交互模式:`agent-guard setup --key <k> --agents zcode,claude --scope user --yes`(支持 `--dry-run` 只看计划)。

> 数据目录:`~/.agent-guard/`(config / 判定缓存 / 审计日志);key 存 `~/.agentguardrc`。

## CLI 使用(`agent-guard`)

全局安装后执行 `agent-guard <命令>`,三个子命令:

| 命令 | 作用 |
| --- | --- |
| `agent-guard setup` | 四步向导:探测/输入 key → 选工具 → 作用域 → 确认写入(见上文) |
| `agent-guard check` | 手动评估一条命令/工具调用,不经过 hook |
| `agent-guard hook` | hook 管道模式(stdin JSON → 判定 → stdout),由各工具的 hook 配置调用,一般不手动执行 |
| `agent-guard --version` / `--help` | 打印版本 / 用法 |

### setup 参数

| 参数 | 说明 |
| --- | --- |
| `--key <k>` | 直接提供 TypeSafe key,跳过探测与交互输入 |
| `--agents a,b` | 指定工具(`zcode` / `claude` / `cursor`,逗号分隔),跳过交互多选 |
| `--scope user\|project` | 用户级(全部项目生效)或项目级(当前目录),跳过交互选择 |
| `--yes` | 免最后确认,配合前三个参数即全程无交互 |
| `--dry-run` | 只打印写入计划,不写任何文件(含 `~/.agentguardrc`) |
| `--no-verify` | 跳过 key 的真实 API 验证 |

完全非交互的一键安装(CI/脚本场景):

```bash
agent-guard setup --key <TYPESAFE_API_KEY> --agents zcode,claude --scope user --yes
```

### check 参数

```bash
agent-guard check --cmd "docker compose down"                          # 评估一条 Bash 命令(真实 API)
agent-guard check --tool Write --input '{"file_path":"/tmp/a.txt","content":"x"}'
```

输出格式:`level=<allow|confirm|block> rendered=<…> source=<fastpath_*|cache|api> 破坏性风险=<%> 红线违反=<%>`。仓库内开发还可用 `node check.mjs --mock`(离线固定判定;依赖 `test/fixtures/`,不随 npm 包发布)。

## 本地开发:手动启用 hook(不装全局包)

以 ZCode 为例(本仓库开发环境;Claude Code / Cursor 的入口由 `agent-guard setup` 自动写入对应配置文件),在工作区配置 `<workspace>/.zcode/config.json`(或用户级 `~/.zcode/cli/config.json`,对所有项目生效)添加(hook 路径填本仓库的 hook.mjs 绝对路径,正斜杠):

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
              "args": ["<本仓库绝对路径>/hook.mjs"],
              "timeoutMs": 15000
            }
          ]
        }
      ]
    }
  }
}
```

> 注意 `hooks.enabled: true` 必须显式设置(ZCode 配置文件 hook 默认禁用);配置修改后需**完全重启宿主工具**生效。

## 手动评估(不经过 hook)

```bash
cd agent-guard

# 离线 mock(用 test/fixtures/judgments.json 的固定判定,无需 key)
node check.mjs --mock --cmd "git reset --hard HEAD~1"
# → level=confirm rendered=deny source=api 破坏性风险=77% 红线违反=40% (6ms)

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
| `proxy.enabled` / `host` / `port` | `false` / 空 / `0` | TypeSafe API 走 HTTP CONNECT 代理;模板示例 `127.0.0.1:7890`,详见上文"网络代理" |

调阈值不需要动代码或问题文案——缓存存的是原始概率,阈值改动即时生效。

## 审计日志

`logs/audit.jsonl` 逐行记录每次判定:`ts`(本地时间,ISO 带时区偏移)、`tool`、命令/路径摘要(≤200 字符)、`source`(fastpath_*/cache/api/error)、`risk` 与概率分布、`violation`、`level`、实际渲染的决策、`reason`、耗时。调阈值、回溯误判、填 MCP 豁免名单都以此为准。

```bash
tail -5 logs/audit.jsonl
```

## 测试与项目结构

```bash
npm test          # 74 个测试(config/state/fastpath/decide/emit/typesafe/judge/hook 集成/样例集/setup/proxy)
```

```
agent-guard/
  hook.mjs        # PreToolUse 入口(stdin→判定→stdout,异常兜底 fail-closed)
  check.mjs       # 手动评估 CLI(--cmd / --tool+--input / --mock)
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

设计与决策细节见 [docs/specs/2026-09-20-agent-guard-design.md](docs/specs/2026-09-20-agent-guard-design.md),实施过程见 [docs/plans/2026-09-20-agent-guard.md](docs/plans/2026-09-20-agent-guard.md),发布与迭代流程见 [docs/release.md](docs/release.md)。
