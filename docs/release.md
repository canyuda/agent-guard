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

# 4. 推送代码与 tag
git push --follow-tags origin master

# 5. 发布(publishConfig.access=public 已配,无需 --access)
npm publish

# 6. 验证
npm view @canyuda/agent-guard
```

### 版本号怎么选

| 变更类型 | 级别 | 例 |
| --- | --- | --- |
| 修 bug、文案、README | patch | 0.1.0 → 0.1.1 |
| 新增命令/参数/工具支持(如新增 Claude Code 目标) | minor | 0.1.x → 0.2.0 |
| 改配置 schema、setup 写入结构、判定/渲染语义 | major | 0.x → 1.0.0 |

0.x 阶段社区默认"不保证兼容",但本项目用户装的是**全局安全工具**,升级即生效——判定的行为变化(哪怕只是文案)也应视为对用户可感知,宁可选高一级。

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

## 五、远期:自动化发布(现在不动手)

- **GitHub Actions**:tag push 触发 → matrix(node 20/22)跑 `npm test` → `npm publish`;凭证用 npm 账号生成的 automation token 存 repo secret `NPM_TOKEN`(绕过 2FA 交互),或接入 npm 的 OIDC trusted publishing(免 token)。
- **CI 门禁**:PR 上只跑测试,publish 仅 tag 触发,避免误发。
- 在此之前,发布保持手动第五章流程,步骤少且有 pack 清单把关,手动不构成负担。
