# 试点上线记录(Task 10,2026-09-20)

- 上线时间:2026-09-20 16:07(UTC 08:07),用户完全重启 ZCode 后,工作区 hooks 由探针切换为 `hook.mjs`
- 模式:完全访问(yolo),`degrade_ask_to_deny: false`(confirm 弹原生确认框,block 硬 deny)

## 三条冒烟实录(audit.jsonl)

| 命令 | source | 判定/渲染 | 耗时 | 结果 |
| --- | --- | --- | --- | --- |
| `echo pilot-ok` | fastpath_allow | allow/allow | 0ms | 放行 ✅ |
| `tar --version` | error(no_key) | confirm/**ask** | 3ms | 弹框,用户批准后执行 ✅(fail-closed 正确) |
| `rm -rf ./no-such-dir/` | fastpath_block | block/**deny** | 0ms | 硬拦截,理由回流给 agent ✅ |

## 上线即发现并修复的问题

**hook 子进程拿不到 `TYPESAFE_API_KEY`**:注册表用户级环境变量没有传导到 ZCode 的启动链,`tar --version` 首跑即 `no_key` → confirm(fail-closed 按设计兜底)。修复:按 spec §7 预案落 `~/.agentguardrc`(key 从注册表读入,不回显)。复测 `tar --version | head -1` → `source=api, risk=0.00, violation=0.00, 904ms, allow` ✅。**教训:凡 hook/子进程要用的环境变量,rc 文件不是备选而是主路径。**

## 试点观察项(§9b 剩余四条,达标后迁全局 `~/.zcode/cli/config.json`)

- [ ] 零 hook 崩溃/超时(ZCode 日志无 failed/timed-out)
- [ ] 审计中 allow 但人工复核属高危 = 0
- [ ] 非高危被拦(误伤)率 < 10%,超标先调阈值/白名单
- [ ] 依据 MCP 审计数据(source=api 的 mcp__ 条目)填 `fastpath.mcp_allowlist` 初值

## 已知观察点

- agent 的命令多为 `cd "…" && cmd` 复合形式,白名单 `^git status` 等锚定行首的正则匹配不上 → 大量本应白名单的命令走了 API/缓存(每次约 1s + 数百 token)。观察 `source=api` 占比,误伤感明显时把白名单升级为允许 `cd <path> &&` 前缀。
- 缓存 TTL 60min 会吸收大部分重复复合命令(缓存键含完整命令串)。

## 日常工具

```bash
tail -5 logs/audit.jsonl                 # 看最近判定(⚠️ 第二阶段 T2 合入后迁至 ~/.agent-guard/logs/audit.jsonl)
node check.mjs --cmd "<任意命令>"          # 手动评估(真实 API)
node check.mjs --mock --cmd "git reset --hard HEAD~1"   # 离线看三级判定
```
