# Cursor hooks schema 核查结论(Task 1,2026-09-20)

来源:cursor.com/docs/hooks(WebFetch 直连成功,HTTP 200;代理 curl 同样可达,双源一致)。

## 采纳的 schema(T4 cursor writer 依据)

- **配置文件**:用户级 `~/.cursor/hooks.json`,项目级 `<project>/.cursor/hooks.json`(独立 hooks.json,**不是** settings.json;优先级 Enterprise > Team > Project > User)
- **顶层形态**:`{ "version": 1, "hooks": { "<event>": [ { … } ] } }`
- **事件名是 camelCase**:`preToolUse`(不是 Claude 的 `PreToolUse`)
- **条目字段**:`command`(必填)、`timeout`(**秒**)、`matcher`(regex;preToolUse 匹配的是**工具类型名**:`Shell`、`Read`、`Write`、`MCP:<tool_name>`)、`type`("command"/"prompt")、`failClosed`(true=hook 失败时阻断而非放行)、`loop_limit`
- **本项目写入条目**:
  ```json
  { "version": 1, "hooks": { "preToolUse": [
      { "command": "node \"<pkg安装路径>/hook.mjs\"", "timeout": 15,
        "matcher": "Shell|Write|Edit|MCP:", "failClosed": true }
  ] } }
  ```
  - matcher 用 Cursor 工具类型名(Shell≠Bash;MCP 是 `MCP:<name>` 前缀,故用 `MCP:` 匹配全部 MCP;`Edit` 类型名文档未单列,冗余写上无害)
  - `failClosed: true` 与本项目 fail-closed 哲学一致(hook 进程崩了也阻断)
  - upsert 语义同其他工具:version 保留,preToolUse 数组本项目条目替换/追加,他键不动

## 兼容性事实(记录)

- Cursor 声明支持加载 Claude Code 第三方 hooks:exit code 2 阻断行为一致、提供 `CLAUDE_PROJECT_DIR` 别名 → 本项目输出(Claude 形态 `hookSpecificOutput`)**预计**被接受,但 **JSON 决策字段(ask/deny)在 Cursor 下的实际效果未实测**——列入 T8 安装后验证项(实测不行也不影响 ZCode/Claude 主路径,届时可在文档标注)
- 云端 agent 会读仓库根 `.cursor/hooks.json`(项目级天然支持远程场景)

## 降级分支

未触发(schema 干净,无需降级"检测到但不写")。
