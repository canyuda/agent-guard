# 试点观察:同意死锁(2026-09-24)

## 背景

09-24 验收测试发现:**完全访问模式下 ask 不再弹确认框,而是被静默放行**(与 [2026-09-20 契约实测](2026-09-20-contract-findings.md)和[试点记录](2026-09-20-pilot-start.md)中"ask 弹原生确认框、用户批准后执行"的行为相反)。实测样例:`docker compose down`(risk 2.0 → confirm → ask)未经任何交互直接执行。

当日应对:`~/.agent-guard/config.json` 切回 `degrade_ask_to_deny: true`(confirm 级用 deny 承载),消除完全访问模式下的直通窗口。切换即时生效(配置每判定现读;缓存只存概率,渲染现算),同命令同缓存 ask→deny 已实测验证。

## 死锁现象

切回 true 后出现**同意死锁**:`git push origin master`(risk 59% → confirm → deny)被硬拦,deny 文案要求 agent"等待用户自行执行**或明确同意**"。但用户明确回复"同意 push"后,agent 重试同命令**仍被 deny**(缓存命中,判定复用)。

**"明确同意"对 agent 没有可操作的放行通道:**

- 重试 → 缓存/TTL 60min 内判定不变;
- 改写命令变体(换等价写法绕开缓存键)→ 文案明令禁止的"规避";
- 临时切配置/清缓存再执行 → 属于动守卫状态让命令通过,同为规避;
- ask 承载本可承载"同意"(弹框点批准),但当前完全访问模式 ask 无确认面。

结论:fail-closed + ask 无确认面的组合下,**confirm 级操作事实上只能由用户在终端手动执行**,deny 文案中"或明确同意"一句对 agent 场景是兑现不了的承诺。

## 时间线实录(audit.jsonl)

| 时间(本地) | 命令 | 判定 | 渲染 | 结果 |
| --- | --- | --- | --- | --- |
| 14:40 | `docker compose down` | confirm(risk 2.0) | ask | **静默放行,执行**(切换前) |
| 14:43 | 同命令(缓存命中) | confirm | **deny** | 硬拦(切换后,配置热生效验证) |
| 14:49 | `git push origin master` | confirm(risk 59%) | deny | 硬拦,commit 留本地 |
| 15:0x | 同命令(用户已明确同意) | confirm(缓存) | deny | **仍硬拦 → 死锁实证** |

## 候选缓解(按侵入性排序)

1. **白名单显式授权**(策略层正道):把人审过的命令形态加入 `fastpath.allowlist`,如 `^git push(?!.*--force)`(--force 仍被黑名单拦);一次决策、长期免拦。
2. **误伤观察驱动调阈值**:今日 confirm 误伤样例集中在复合 git 操作(`cd … && git restore --staged … && git commit …` 57%)与 push(59%),按 §9b 用 `source=api + rendered=deny` 筛查复核,必要时调 `confirm_risk`。
3. **ZCode ask 确认面回归**:若后续版本完全访问模式恢复 ask 确认面(09-20 行为),可切回 `degrade_ask_to_deny: false`,confirm 恢复原生弹框承载。
4. **远期**:hook 增加带审批凭据的放行机制(如用户一次性签发的 token 传给 hook),让"明确同意"有真实通道——需改契约,暂不动。

## 待办

- [ ] 推进观察项:统计今日 `rendered=deny` 中实际无害条目占比(误伤率)
- [ ] 决策:`git push(?!.*--force)` 是否入白名单(用户 pending)
- [ ] 向 ZCode 侧确认:完全访问模式 ask 确认面行为变化是版本差异还是配置差异
