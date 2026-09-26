# 0001 — degrade_ask_to_deny 默认 false(confirm 用 ask 承载)

- 日期:2026-09-26
- 状态:已接受(用户决策)

## 背景

spec §5/§12 曾按 Claude Code #77212 的最坏情况把默认定为 `true`(confirm 经 deny 承载,防 ask 被静默放行)。2026-09-26 架构评审发现包内模板 `config.json` 已随试点切为 `false`,与 `DEFAULTS` 的 `true` 漂移,当时被当作安全缺陷提议把模板改回 `true`。

## 决策

`DEFAULTS` 与模板统一为 **`false`**:confirm 级用 `ask`(宿主原生确认框)承载,block 级仍 deny。

## 理由

- 用户运行在完全访问模式且对此知情;该模式的意义就是不被反复打断。
- agent-guard 的职责是拦高危(block 级/黑名单,fail-closed 不变),不是把所有 confirm 都升格为 deny——否则完全访问模式形同虚设。
- ZCode 契约实测(docs/notes/2026-09-20-contract-findings.md):完全访问模式下 `ask` 有原生确认面,confirm 级仍有人工闸门。

## 后果

- 在 ask 会被静默放行的宿主上(如 Claude Code #77212 报告的行为),confirm 级不再被 deny 兜底。接入新宿主前需实测 ask 行为,不符时用配置一键切回 `true`。
- 架构评审不再把「模板与 DEFAULTS 的 false 不一致」当缺陷;`config.test.mjs` 的防漂移断言锚定本决策。
