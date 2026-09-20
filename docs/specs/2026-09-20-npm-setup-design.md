# agent-guard CLI 发布与 setup 设计

- 日期:2026-09-20
- 状态:待用户审阅
- 前置:`docs/specs/2026-09-20-agent-guard-design.md`(守卫本体 v2);本文档只覆盖**发布工程化与 setup 命令**,不改变判定/快路径/审计语义
- 修订:v1

## 1. 目标

把 agent-guard 从本地项目升级为 **npm 官方发布的全局 CLI**(包名占位 `<pkg名>`,发布前查占用后定),提供一条命令完成全部接入:

```
npm install -g <pkg名>@<版本>     # 用户执行(官方源+代理)
agent-guard setup                 # 交互式:key 配置 + 选工具(多选) + 选作用域 + 确认写入
```

setup 确认后自动修改所选 AI 编程工具的 hook 配置,实现 cmd-guard 同款开箱体验,但策略/阈值仍全在用户侧 config。

### 非目标

- `setup --remove`(反向卸载)→ 二批
- npm 账号注册/组织管理(用户自理)
- 判定逻辑、快路径、审计格式变更(守卫本体不变)
- CI/CD 自动发布(手动 `npm publish`)
- 支持工具清单做插件化扩展(目标矩阵硬编码三款,后续按需加)

## 2. 背景事实(已核实,2026-09-20)

- npm `agent-guard` 名已被占用:v1.2.2(dipampaul17/AgentGuard,AI 成本防护,**无 bin 字段**)→ 包名需另定,bin 名 `agent-guard` 无冲突
- 本机 npm registry 默认淘宝镜像(npmmirror)→ publish 必须显式 `--registry https://registry.npmjs.org`,且需本地代理
- 本机 `~/.claude/settings.json` 已有 hooks(Stop/SessionEnd 挂 ai-usage 通知器)→ 写入必须合并、不得覆盖
- Cursor 官方已支持生命周期 hooks(PreToolUse 类),且声明兼容加载 Claude Code 形态第三方 hook;**确切配置 schema 未核实**,实施首日拉官方文档定稿
- ZCode 用户级 `~/.zcode/cli/config.json` 已存在(`hooks.events:{}` 空结构就绪)
- 守卫契约已实测:ZCode 输出 `hookSpecificOutput.permissionDecision` 生效;Claude Code 同形态(cmd-guard 先例);stdin `tool_name`/`tool_input` 双命名兼容

## 3. 总体架构

```
<pkg名>(全局安装)
  bin/agent-guard.mjs          # 统一 CLI 入口(shebang),子命令分发
    setup  → lib/setup.mjs     # 交互式配置向导(核心逻辑纯函数,薄交互壳)
    check  → 复用 check 逻辑   # 手动评估(--cmd/--tool/--input/--mock)
    hook   → 复用 hook 逻辑    # stdin 模式,各工具 hook 指向这里
  hook.mjs / check.mjs         # 保留为薄转发(向后兼容试点期工作区配置)
  lib/                          # config/state/fastpath/decide/emit/typesafe/judge/log + setup
数据目录 ~/.agent-guard/        # 全局安装后唯一可写位置(npm 升级覆盖包目录)
  config.json  cache/judgments.json  logs/audit.jsonl
密钥 ~/.agentguardrc            # 沿用 cmd-guard 约定,仅存 key
```

## 4. 数据目录改造(发布化的核心变更)

全局安装后包目录只读且升级即覆盖,config/缓存/审计迁出包目录:

- **解析链**:env `AGENT_GUARD_CONFIG` > `~/.agent-guard/config.json` > 包内默认 `config.json`
- 首次运行:若 `~/.agent-guard/` 无 config.json,从包内默认**复制生成**(用户此后改自己这份,升级不丢配置)
- `cache/judgments.json`、`logs/audit.jsonl` 一律落 `~/.agent-guard/` 子目录
- `lib/config.mjs` 的 `PROJECT_ROOT` 相对路径假设全部替换为数据目录抽象;涉及 config.mjs/log.mjs/judge.mjs 的路径行,测试同步迁移
- 现有试点(工作区 hooks 指向本地副本)不迁移不动,直到 §8 衔接步骤

## 5. CLI 入口与子命令

`bin/agent-guard.mjs`(`#!/usr/bin/env node`,`process.argv[2]` 分发):

| 子命令 | 行为 | 非交互 flags |
| --- | --- | --- |
| `setup` | §6 四步向导 | `--key <v>`、`--agents zcode,claude,cursor`、`--scope user\|project`、`--dry-run`、`--no-verify` |
| `check` | 现 check.mjs 全部参数原样 | 同现有 |
| `hook` | 现 hook.mjs stdin→判定→stdout | 无(管道模式) |

无参数打印 usage。`hook.mjs`/`check.mjs` 顶层转发到 bin 逻辑(单行 import+call),旧调用方零破坏。

## 6. setup 流程(四步,单作用域)

```
[1/4] TypeSafe key
   探测链:env TYPESAFE_API_KEY → win32 时 powershell 读用户注册表 → 既有 ~/.agentguardrc
   探测到 → 显示掩码(ts***xy),询问是否采用
   未探测/拒绝 → 交互输入(或 --key;注意:readline 无法隐藏输入,提示留意肩窥)
   写 ~/.agentguardrc(已存在先备份 .bak;格式 TYPESAFE_API_KEY="<v>")
   默认真实调用一次 API 验证 key(--no-verify 跳过),失败打印错误分类
[2/4] 选工具(多选 checkbox)
   自动检测:~/.zcode/cli/config.json 存在→ZCode;~/.claude→Claude Code;~/.cursor→Cursor
   检测到的默认勾选;未检测的可手动勾(仍写入)
[3/4] 选作用域(单选,对全部选中工具统一生效)
   用户级 → ~ 下配置 / 项目级 → 当前目录配置(目录不存在则创建)
[4/4] 计划表确认
   每目标一行:配置文件路径 + 将 upsert 的 JSON 片段 + 备份位置
   y 执行 / n 退出;--dry-run 永远停在本步
```

混搭作用域(如 ZCode 用户级 + Claude 项目级)= 分两次跑,flags 组合即非交互模式(脚本/CI 可用)。

### 6.1 写入规则(所有目标一致)

- 写前备份 `<file>.bak`(同目录)
- JSON 读→改→写(2 空格缩进,保留其余全部键)
- **只对 `PreToolUse` 数组做 upsert**:存在"本项目条目"(按 hook 命令指向本包路径识别)则替换,否则追加;matcher 统一 `Bash|Write|Edit|mcp__.*`
- 损坏 JSON(解析失败):不写,报告并建议手动处理,备份仍保留
- **作用域防撞**:project 作用域且 `cwd === home` 时拒绝执行并提示(项目级路径会与用户级路径重叠)
- 幂等:重复 setup 不产生重复条目
- 结束摘要:每工具一行(已写入 / 已存在更新 / 跳过原因)+「重启对应工具生效」

### 6.2 目标矩阵

| 工具 | 用户级文件 | 项目级文件 | hook 条目形态 |
| --- | --- | --- | --- |
| ZCode | `~/.zcode/cli/config.json` | `<cwd>/.zcode/config.json` | `hooks.enabled:true`;`events.PreToolUse[]` + `{type:"process", command:"node", args:["<pkg安装绝对路径>/hook.mjs"(正斜杠)], timeoutMs:15000}` |
| Claude Code | `~/.claude/settings.json` | `<cwd>/.claude/settings.json` | `hooks.PreToolUse[]` + `{type:"command", command:"node \"<pkg安装绝对路径>/hook.mjs\"", timeout:15}`(秒) |
| Cursor | `~/.cursor/…`(实施首日按官方文档定稿) | `<cwd>/.cursor/…` | 同官方 schema;**降级策略**:文档拿不到干净 schema → 检测到但仅提示手动配置,不写 |

- `<pkg安装绝对路径>` 运行时从 `import.meta.url` 解析(bin 所在目录),不硬编码 → npm 升级后路径不变,hook 自动用新版
- 项目级 `.zcode/`/`.claude/` 目录不存在则创建;是否入库由用户决定,setup 不代管 .gitignore

## 7. 发布工程

### 7.1 package.json 字段

`name=<pkg名>`(发布前定)、`version=0.1.0`、`description`、`bin={"agent-guard":"./bin/agent-guard.mjs"}`、`files=["bin","lib","hook.mjs","check.mjs","config.json","README.md","LICENSE"]`(**排除 test/docs/probe/.cache/logs**)、`engines={"node":">=20"}`、`license=MIT`、`repository`(GitHub)、`keywords=[agent,hook,guard,typesafe,claude-code,zcode,cursor]`

### 7.2 发布前验证(只读,工程师执行)

`npm pack` → 解包检查:无密钥/无 `~` 个人路径残留/无 test/docs 混入/体积 KB 级/bin 可执行;检查通过才生成发布命令。

### 7.3 发布与安装(用户执行,官方源+代理)

```bash
# 0. 先推 GitHub(开源仓库,npm repository 链接;gh 可用或网页建仓,走代理)
#    gh repo create <user>/agent-guard --public ; git remote add origin … ; git push -u origin master
npm login --registry https://registry.npmjs.org
HTTPS_PROXY=http://127.0.0.1:7890 npm publish --registry https://registry.npmjs.org
HTTPS_PROXY=http://127.0.0.1:7890 npm install -g <pkg名>@0.1.0 --registry https://registry.npmjs.org
```

## 8. 试点衔接

1. 全局包安装完成、`agent-guard setup` 挂好用户级 ZCode 并验证判定正常后
2. **移除工作区 `.zcode/config.json` 的 hooks 条目**(避免同会话双重判定:全局+工作区各跑一次)
3. §9b 试点观察无缝切到全局包,计时继续;本地仓库继续作为开发副本(改代码 → bump 版本 → 重新发布)

## 9. 测试(TDD,交互壳外全覆盖)

- 数据目录抽象:解析链三级/首启复制/升级不丢配置(env 覆盖 > 用户文件 > 包默认)
- setup 核心纯函数:upsert(新增/替换/幂等)、备份、保留他键(用本机真实 settings.json 结构做样例:Stop/SessionEnd 必须原样)、损坏 JSON 拒写
- 探测链:env/注册表(win32 mock)/rc 三级与掩码
- 目标矩阵:三工具 × 两作用域的文件路径与条目生成(hook 路径注入 fake root)
- CLI:flags 解析、分发、无参 usage
- 端到端:临时 HOME 下 setup --key --agents zcode --scope user --dry-run 不写盘;去 dry-run 写盘且幂等

## 10. 已定决策(用户,2026-09-20)

1. 发布到 npm 官方,`npm install -g <pkg名>@<版本>` 安装(用户给的步骤 0/1)
2. `setup` = key 配置 + 工具多选 + **作用域单选(用户级 ~ / 项目级 cwd,独立步骤)** + 确认后写配置(步骤 2/3)
3. 包名为占位符,发布前查占用后定(bin 固定 `agent-guard`,当前无冲突)
4. license MIT
5. `--remove` 二批;Cursor 首批做,schema 核实不了则降级提示不硬编
6. 发布/安装/登录命令由用户执行(官方源+代理)
7. 判定语义零变更,只动发布工程与接入方式

**grilling 补充(2026-09-20 第二轮)**:
8. license MIT、首发 0.1.0、发布前先推 GitHub(repository 链接 + 开源)
9. `--remove` 二批、Cursor 首批带降级 —— 正式确认
10. 数据目录 `~/.agent-guard/` 确认;试点审计位置将随之迁移(见 pilot 文档)
11. project 作用域 `cwd === home` 拒绝执行(防撞用户级路径)
12. 实施沿用 master 分支(与一阶段一致,用户知情)

## 11. 风险与验证项

1. **Cursor schema 未核实**:实施第一个动作拉官方 hooks 文档;不可得 → 走降级(检测+提示手动)
2. **bin 撞名**:发布前复查 `<pkg名>` 与 bin `agent-guard` 在 npm 的占用(当前查过:名被占的包无 bin)
3. **npm publish 网络路径**:官方源 + 本地代理缺一不可;登录态过期由用户重登
4. **双判定窗口**:全局包与工作区 hooks 并存期间每条命令判两次(行为一致,仅延迟翻倍);按 §8 步骤 2 尽快收敛
5. **readline 明文输入**:`--key` 参数会进 shell 历史,交互输入优于参数,文档注明
