# agent-guard 设计文档

- 日期:2026-09-20
- 状态:已与用户对齐设计,待实施
- 项目位置:`C:\Users\epsoft-bc\.zcode\workspace\default\agent-guard\`

## 1. 目标

为 ZCode 提供一层工具调用安全守卫:在 `PreToolUse` 事件拦截 `Bash`、`Write`、`Edit` 及全部 MCP 工具(`mcp__.*`),用 TypeSafe System One 模型(Jev)判断操作的破坏性风险与安全红线违规,低风险放行,高风险转人工确认(ask)后才执行。

### 非目标

- 不默认启用自动拦截(deny):deny 保留为配置开关,默认关闭,主通道是 ask
- 只处理 `PreToolUse`,不覆盖其余六个 hook 事件
- 不替代 ZCode 自身权限系统,只在其之前追加一层语义判断
- 不做服务端部署、多用户、UI

## 2. 背景与先例

- **cmd-guard**(PyPI `cmd-guard`,源码 github.com/NieXi/agent-guard):Claude Code 上的同类实现,Python + TypeSafe。判断设计为三问(`destructive_risk` Score / `policy_violation` Noul / `decision` Choice),fail-closed 兜底,支持 `~/.agentguardrc` 配置文件与 `--mock` 离线模式。本项目借鉴其风险分级、hook 契约与 rc 文件约定,不采用"让模型直接选 decision"的做法(理由见 §5)。
- **ZCode hook 机制**(zcode-guide:diagnosing-hooks):
  - 配置在 `~/.zcode/cli/config.json` 顶层 `hooks` 键,形如 `{ enabled, timeoutMs?, maxOutputBytes?, events: { <Event>: [...] } }`;**配置文件 hook 默认禁用,必须显式 `hooks.enabled: true`**
  - 事件共七个,本项目用 `PreToolUse`;matcher 是对**工具名**的大小写敏感正则,别名 `Write`/`Edit` ← `ApplyPatch`、`Task` ↔ `Agent`
  - `type: "process"`:可执行文件 + `args[]` 参数数组,不经 shell,Windows 首选
  - 输出:stdout 按严格 JSON schema 解析(多余 key 校验失败),或用退出码——0 放行、2 拦截(deny)、其他非零报错;`PreToolUse` 可返回 `allow`/`ask`/`deny` 三种权限决策

## 3. 总体架构与数据流

```
ZCode PreToolUse (matcher: Bash|Write|Edit|mcp__.*)
  → stdin: { hook_event_name, tool_name, tool_input, ... }   ← 字段名待实测验证(§13)
  → hook.mjs
      1. lib/state.mjs     按工具构造 state(命令/文件/参数,截断)
      2. lib/fastpath.mjs  白名单→allow;黑名单→ask(带警告);缓存命中→复用
      3. lib/typesafe.mjs  灰色地带调 API:两问并行,单次请求
      4. lib/decide.mjs    概率 → 决策(纯函数,阈值来自 config.json)
      5. lib/log.mjs       JSONL 审计
      6. 输出:permissionDecision JSON;失败兜底走退出码
  → ZCode:放行 / 弹原生确认框(ask)
```

组件职责:

| 组件 | 职责 | 依赖 |
| --- | --- | --- |
| `hook.mjs` | 入口:读 stdin、编排 1-6、写 stdout/退出码 | 全部 lib |
| `check.mjs` | 手动 CLI:`--cmd` / `--tool`+`--input` / `--mock`,不经 hook 管道直接看判定 | state/fastpath/typesafe/decide |
| `lib/state.mjs` | 从 `tool_name` + `tool_input` 构造 TypeSafe state | 无 |
| `lib/fastpath.mjs` | 白/黑名单正则匹配;判定缓存读写 | config |
| `lib/typesafe.mjs` | API 调用封装:超时、错误分类(禁用自动重试) | SDK |
| `lib/decide.mjs` | Score/Noul 概率 → allow/ask/deny 纯函数映射 | config |
| `lib/config.mjs` | 加载 `config.json`;解析 API key(env → `~/.agentguardrc`) | 无 |
| `lib/log.mjs` | JSONL 审计追加写 | config |
| `config.json` | 阈值、名单、缓存、日志开关 | — |

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

## 5. 决策映射(策略留在代码)

与 cmd-guard 的关键分歧:不让模型直接选 allow/ask/deny(第三问 Choice),只问风险事实,映射规则写在 `lib/decide.mjs`。理由(TypeSafe 设计哲学):改阈值、调分级不需要重跑推理或改问题语义;缓存可跨阈值复用;误判可从审计日志回溯到具体概率。

默认规则(阈值均在 `config.json` 可调,Score 为概率加权的连续值 0~3):

```
若 deny_enabled 且 (risk ≥ 2.5 或 violation ≥ 0.85) → deny
否则若 risk ≥ 2.5 或 violation ≥ 0.85              → ask(附高危警告)
否则若 risk ≥ 1.5 或 violation ≥ 0.5               → ask
否则                                               → allow
```

`deny_enabled` 默认 `false`:误拦截代价大于多一次人工确认,用户需求的主通道是"人工确认后才执行"(ask)。

## 6. 快路径(控延迟与费用)

三层漏斗,大部分调用不触碰 API:

1. **白名单正则**(config: `fastpath.allowlist`):`git status`、`git diff`、`git log`、`ls`、`cat`、`node --version`、`npm ls` 等明确只读 → 直接 allow
2. **黑名单正则**(config: `fastpath.denylist`):`rm -rf`、`format`、`:(){ :|:& };:`、`git push --force` 等明确破坏 → 直接按 §5 高危分支(默认 ask+警告)
3. **判定缓存**:`.cache/judgments.json`,key = `sha1(tool + 归一化输入)`(归一化仅去首尾空白,不做参数级改写以免误判;Bash 用命令串;Write/Edit 用 file_path+content_prefix 哈希,内容变即 miss;MCP 用 server+工具+参数),TTL 60 分钟,上限 500 条(LRU 淘汰)。TypeSafe 文档:证据与问题含义未变无需重跑推理

三层均未命中才调 API。快路径命中同样写审计日志,标记 `source` 区分。

## 7. 配置形态

**ZCode hook 配置**(追加到 `~/.zcode/cli/config.json` 顶层,注意 `enabled: true` 必需):

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

路径用正斜杠(process 型不经 shell,但统一正斜杠避免歧义)。

**API key 解析顺序:** 环境变量 `TYPESAFE_API_KEY`(用户已配在 Windows 用户注册表,hook 子进程继承 ZCode 进程环境)→ `~/.agentguardrc`(`TYPESAFE_API_KEY="..."`,cmd-guard 同款约定,防 ZCode 启动时环境未带)→ 都没有则按失败兜底(§8)。key 只在内存与请求头使用,不写日志、不回显。

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
| API 网络失败 / 8 秒超时 / 5xx | ask,reason 注明"评估服务不可用" |
| Key 缺失 | ask,reason 注明"未配置 API key" |
| 响应解析异常 / schema 不符 | ask,reason 注明原始错误类别 |
| hook 自身异常 | 顶层兜底捕获并尽力输出 ask JSON;若进程仍崩溃则以非零退出,ZCode 记为失败——两种路径都不放行 |
| ZCode 侧超时 | hook `timeoutMs: 15000` 整体兜底(超时按 ZCode 语义记 timed-out) |

原则:**fail-closed → ask**(用户已定):不静默放行,有人值守时只多一次确认;API 单次请求超时 8 秒且 hook 路径不自动重试(hook 场景宁快勿拖;SDK 若无法禁用重试则切换零依赖直连,见 §11)。`check.mjs` 手动模式保留 SDK 默认重试便于诊断。

## 9. 审计日志

`logs/audit.jsonl` 逐行追加,默认开启(config 可关):`ts`、`tool`、`input_digest`(命令/路径摘要,内容只存前 200 字符)、`source`(api/fastpath_allow/fastpath_deny/cache)、`risk`、`risk_probabilities`、`violation`、`decision`、`reason`、`duration_ms`。用途:调阈值有据可依、回溯误判。不做滚动,单文件,满了手动清理。

## 10. 测试与调试

- **单元测试(node:test,TDD)**:`decide.mjs` 映射边界值;`fastpath.mjs` 正则与缓存淘汰;`state.mjs` 各工具构造与截断;`typesafe.mjs` 用桩客户端测错误分类
- **样例集(≥12 条,`--mock` 用固定桩值离线跑)**:
  `git status`→allow(白名单)、`node --version`→allow、`npm install lodash`→allow(受控)、编辑 `src/Main.java`→allow、`git reset --hard HEAD~1`→ask(改历史)、`docker compose down`→ask(停服务)、`taskkill /F /IM java.exe`→ask(杀进程)、`rm -rf /`→ask+警告(黑名单)、`git push --force origin main`→ask+警告、写 `/etc/sudoers`→ask+警告(violation)、fork 炸弹→ask+警告、`echo hi`→allow
- **管道级**:`echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git diff"}}' | node hook.mjs` 验证输出契约与退出码

## 11. 依赖与运行时

- Node ≥ 20(SDK 要求;本机 24.19.0 ✓),`@typesafe-ai/sdk`(npm)
- **备选路径 B(零依赖)**:Node 内置 fetch 直连 `POST https://api.typesafe.ai/v1/systemone`,约 30 行 + 单次重试;当 SDK 装不上或无法禁用重试/设超时时降级,脚本主体不变
- api.typesafe.ai 本机直连可用(不走代理);npm 安装需走本地代理,安装命令由用户亲自执行
- 成本量级:灰色地带单次调用约数百 input token,配合快路径,日常可忽略

## 12. 已定决策(用户,2026-09-20)

1. 拦截范围:`Bash|Write|Edit|mcp__.*`(全量)
2. API 失败/超时:转人工 ask(fail-closed)
3. SDK:JavaScript(`@typesafe-ai/sdk`),备选零依赖直连
4. deny 默认关闭,仅 ask
5. 项目位置:`C:\Users\epsoft-bc\.zcode\workspace\default\agent-guard\`

## 13. 实施时需首先验证的风险

1. **ZCode PreToolUse 输出 JSON 的确切 schema**:严格校验下多余 key 即失败;预计同 Claude Code 的 `hookSpecificOutput.permissionDecision` 结构,但必须用样例输入实测并查 ZCode 日志确认。兜底:退出码 0/2 总是可用;若 `ask` 无法用 JSON 表达,降级方案在实施首日定(候选:exit 2 + stderr 原因,或改用 `PermissionRequest` 事件)
2. **ZCode stdin 输入字段名**:预计同 Claude Code(`hook_event_name`/`tool_name`/`tool_input`),同样实测确认
3. **SDK 重试/超时可配置性**:若无法禁用自动重试,启用 §11 备选路径 B
