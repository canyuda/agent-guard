# Hook 契约实测结论(Task 1,2026-09-20)

实测环境:ZCode 完全重启,完全访问模式(stdin 中 `permission_mode: "yolo"`),工作区级 hooks,`type: "process"` 指向 probe.mjs。

## 1. 完全访问模式下三种决策的行为(spec §13 项 1)

| probe 渲染 | 实测行为 | 证据 |
| --- | --- | --- |
| `allow` | 静默放行 | 初期多条命令无感执行 |
| `ask` | **弹原生确认框,人工批准后执行** | 用户亲测两次确认(`git status` ×2,批准后出结果) |
| `deny` | **硬拦截,理由回流给 agent** | agent 的 Bash 调用未执行,工具结果里只有 `[probe] 故意渲染 deny` 文案 |

**结论**:ZCode 的完全访问模式下 `ask` 有确认面(与 Claude Code issue #77212 报告的 bypass 行为不同)。按既定方案(spec §5/§12 决策 10),`degrade_ask_to_deny` 由 `true` 切为 `false`:confirm 级弹框确认,block 级仍 deny。若后续某场景发现 ask 被静默放行,config 一键切回。

## 2. stdout 输出契约(spec §13 项 2)

- 预期:Claude 形态 `hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason}`
- 实测:**采纳**——ZCode 接受该结构;deny 的 reason 会完整展示给 agent;ask 触发原生确认框
- `emit.mjs` 的 `buildOutput` 常量无需改动

## 3. stdin 输入契约(spec §13 项 3)

- 预期:Claude 字段 `hook_event_name` / `tool_name` / `tool_input`
- 实测:**双命名并存,采纳 Claude 兼容组**(`hook.mjs` 零改动)。同一输入同时含:
  - camelCase:`toolName` / `toolInput` / `hookEventName` / `sessionId` / `toolCallId` / `transcriptPath`
  - snake_case:`tool_name` / `tool_input` / `hook_event_name` / `session_id` / `transcript_path` / `tool_use_id`
- 额外字段(记录备用,暂不消费,YAGNI):`permission_mode`("yolo",可做按模式自适应策略)、`riskLevel`("high")、`sideEffectScope`("system")、`mode`、`timestamp`、`traceId`、`turnId`
- 原始样本见项目根 `probe-dump.json`(gitignore,不入库)

## 遗留

- 无。§13 三项全部关闭,试点(hook.mjs)上线。
