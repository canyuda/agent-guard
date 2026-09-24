# 发布与迭代流程(@canyuda/agent-guard)

面向维护者:首次发布(0.1.0,2026-09-24)之后的日常发版流程与注意事项。首次发布前置工程(包名/bin/files/LICENSE/publishConfig)已完成,见 `package.json` 与 git 历史(`70faccd`)。

## 一、发版流程(标准路径)

```bash
# 1. 干净起点:所有改动已 commit(工作区有未提交内容时第 3 步会拒绝)
git status --short

# 2. 全量测试
npm test

# 3. 升版本号(semver,自动 commit + 打 tag,如 v0.1.1)
npm version patch   # 修 bug、文档调整
npm version minor   # 新功能、向后兼容(0.x 阶段主要用它)
npm version major   # 破坏性变更(setup 写入格式、配置 schema、判定语义变化)

# 4. 推送代码与 tag —— tag 上远端即自动触发发布 CI(见"五、自动化发布")
git push --follow-tags origin master

# 5. 等待 CI:仓库 Actions 页确认 release workflow:node 20/22 测试全绿 → publish 完成

# 6. 验证
npm view @canyuda/agent-guard
```

> 手动后备(仅 CI 故障时):本地 `npm publish`(`publishConfig.access=public` 已配,无需 `--access`)。同一版本 CI 已发过会报冲突,先确认 Actions 历史。

### 版本号怎么选(`npm version patch|minor|major`)

`|` 表示**三选一**,实际执行只写一个,如 `npm version minor`。该命令做三件事:递增 `package.json` 的版本号 → 自动 git commit(消息为版本号)→ 打 tag(如 `v0.1.1`)。

版本号是语义化版本(SemVer)三段式 `MAJOR.MINOR.PATCH`,以 `0.1.0` 为例:

| 命令 | 递增哪一位 | 结果 | 语义:什么变更用它 |
| --- | --- | --- | --- |
| `npm version patch` | 末位(修订号) | 0.1.0 → 0.1.1 | 修 bug、文案/文档调整,不改行为 |
| `npm version minor` | 中间位,末位归零 | 0.1.0 → 0.2.0 | 新功能、向后兼容(如 setup 新增支持一个工具) |
| `npm version major` | 首位,后两位归零 | 0.1.0 → 1.0.0 | 破坏性变更(setup 写入格式、配置 schema、判定语义变化) |

判断口诀:**升级后行为和之前完全一样 → patch;多了一样新能力 → minor;旧用法可能失效、需用户跟着调整 → major**。

0.x 阶段社区默认"不保证兼容",但本项目用户装的是**全局安全工具,升级即生效**——判定的行为变化(哪怕只是拦截文案)也对用户可感知,宁可选高一级。

### 发版前检查清单

- [ ] `npm test` 全绿
- [ ] `npm pack --dry-run` 过一眼文件清单:只应含 `bin/ lib/ hook.mjs check.mjs config.json README.md LICENSE package.json`(约 21 个文件);**出现 test/、docs/、logs/、*.tgz、probe* 即 files 失效或混入垃圾**
- [ ] 包内 `config.json` 是仓库模板(proxy.enabled=false、无 key),不是 `~/.agent-guard/config.json`——**key 永远只存 `~/.agentguardrc`,任何路径都不该把它带进包**
- [ ] README 的安装章节、配置字段表与本次改动一致(上次变更过 `degrade_ask_to_deny` 语义/文案格式时要同步)
- [ ] `bin` 命令冒烟:`node bin/agent-guard.mjs --help` 能跑

## 二、发布后验证(5 分钟,别跳过)

```bash
npm view @canyuda/agent-guard                 # 版本/时间/dist-tags 确认
npm i -g @canyuda/agent-guard                 # 干净安装
agent-guard setup --dry-run                   # 向导预览不写盘
agent-guard check                             # 本机 hook 健康诊断
```

升级链路同样要验一次(用户真实路径):

```bash
npm i -g @canyuda/agent-guard@latest && agent-guard check
```

## 三、注意事项(硬约束与本项目特有)

### npm 侧硬约束

- **已发布版本永不复用**:同一版本号不能覆盖重发,改了就得 bump。
- **72 小时规则**:发布超 72h 不能 unpublish;且 unpublish 过的版本号 24h 内不能重用。所以每次 publish 前过一眼 pack 清单。
- **回滚手段分层**:
  - 72h 内发现严重问题:`npm unpublish @canyuda/agent-guard@0.1.2` + 立即发修复版;
  - 超时:不删,用 `npm deprecate @canyuda/agent-guard@0.1.2 "broken in X, use 0.1.3"` 引导升级。
- **预发布通道**:未稳定的改动用 `npm version prerelease --preid=beta` + `npm publish --tag beta`(避免污染 latest,用户装不到 beta 除非显式 `@beta`)。

### 本项目特有

1. **hook 路径与全局包耦合**:setup 写入的 hook command 指向全局安装路径(`npm root -g` 下)。以下情况 hook 会静默失效,用户需重跑 `agent-guard setup` 或先 `agent-guard check` 诊断:
   - 手动改过 npm 全局 prefix / 换了 node 版本管理器(nvm/fnm 切主版本);
   - 卸载重装全局包导致路径变化。
   发版说明里涉及 bin/入口结构变化时,提醒用户 `agent-guard check` 一次。
2. **版本漂移**:开发期工作区挂载的 `hook.mjs` 与 npm 包版本可能不一致(试点配置直接指仓库路径)。对外用户以 npm 包为准;本机试点继续观察仓库版本,两边的判定行为差异记入 docs/notes。
3. **配置热生效边界**:`~/.agent-guard/config.json` 每判定现读(阈值/代理/degrade 开关即时生效),但**判定缓存 TTL 60min 内复用旧概率**——发版若改了概率语义(如 risk 归一),文档要提示用户清缓存或等 TTL 过期。
4. **engines 只警告不阻断**:npm 对 `node >=20` 只给 warning,低版本用户能装上但 hook 可能起不来。README 已写前置条件,重大依赖变化时在发版说明重复强调。

## 四、变更记录

两个地方记,别只发不留痕:

1. **GitHub Releases**:每次 push tag 后在 GitHub 上建 Release,标题即 `vX.Y.Z`,正文列变更点(tag 已由 `npm version` 创建);
2. **CHANGELOG.md**(建议下次 minor 时补上):Keep a Changelog 简版,Unreleased 段落随开发滚动维护,发版时改名归档。

## 五、自动化发布(GitHub Actions,已配置)

流水线文件:`.github/workflows/release.yml`。**任何 `v*` tag 推上远端自动触发**:matrix(node 20/22)跑 `npm test`,全绿后 `npm publish`;tag 名含 `-`(如 `v0.2.0-beta.1`)自动走 `--tag beta`,不污染 latest。PR/普通 push 不触发,只有 tag 会发版。

### 一次性前置(漏了这步 CI 的 publish 必失败)

1. npmjs → 头像 → Access Tokens → Generate New Token,类型选 **Automation**(专供 CI,绕过 2FA 交互),权限覆盖本包读写;
2. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret:名称 **`NPM_TOKEN`**,值为上一步的 token。

### 触发方式

标准触发:第一章流程的 `npm version …` + `git push --follow-tags origin master`(`npm version` 自动打 tag,无需手动)。

不经 `npm version` 的场景(首版 0.1.0 补 tag、给历史 commit 补 tag),手动打 tag:

```bash
# -a 生成 annotated tag(附注标签)——必须带:--follow-tags 随分支推送时只带这种,
# 且与 npm version 打的 tag 类型保持一致;-m 是 tag 说明
git tag -a v0.1.0 -m "v0.1.0"

git push origin v0.1.0          # 单推这个 tag(轻量 tag 用这种方式也能触发 CI)
git push --follow-tags          # 或随分支一起推(只带 annotated tag)
```

两个易错点:

- **tag 名与 package.json 的 version 必须一致**(`v` + 三段版本号):CI 发的是 commit 里 package.json 的版本,tag 只是触发器和 Release 锚点,对不上会造成"tag 是 v0.1.1、发的却是 0.1.0"的混乱。`npm version` 天然一致,手动打 tag 时自己保证;
- tag 要打在**已包含版本号变更的 commit 上**(首版是当前 HEAD;若后续手动补 tag,先 `git log` 确认目标 commit 的 package.json 已是目标版本)。

tag 上远端即自动发布,**之后不要再手动 `npm publish` 同一版本**(会版本冲突)。

首次发布 0.1.0 两条路任选:按上面命令打 `v0.1.0` tag 推上去走 CI(顺便验证流水线,无需本地 `npm login`),或首版手动 `npm publish`、之后统一走 CI。

### 观察与排障

- 观察:仓库 **Actions** 页的 `release` workflow;publish job 失败最常见原因:NPM_TOKEN 未配置/过期(403)、版本号已存在于 npm(EPUBLISHCONFLICT);
- CI 故障时的手动补发见第一章末尾的说明;
- 日常 push/PR 由 `ci.yml`(同 matrix:node 20/22)先行验证,兼容性问题在提交时暴露,不用等发版;
- 后续可选优化:接入 npm OIDC trusted publishing(免 token)。
