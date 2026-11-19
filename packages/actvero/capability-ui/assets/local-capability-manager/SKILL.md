---
name: local-capability-manager
description: 在 ACTVERO Harness 中安装、读取、编辑或启停本机 Skill，创建、修改、测试或启停自定义 MCP。用户说“装个技能”“改一下这个 Skill”“添加或测试 MCP”时使用。
---

# 管理本机 Skill 和 MCP

使用当前会话的 `local_capabilities` 工具。先核对用户指定的来源或本机对象，再按用户要求修改并回读。需要维护组织平台资源时，读取平台管理说明并核对组织与权限。

## Skill

- 从本机目录、ZIP 或 SKILL.md 安装时，用 `skill-install` 提交绝对路径，保存后用 `skill-show` 核对精确 ID、版本和启用状态。
- 修改已安装的 Skill 时，用 `skill-list` 与 `skill-show` 找到目标和版本 ID。用 `skill-read` 读取对应包内文件。用 `skill-edit` 提交原版本 ID 和更新后的完整文本，保留其他文件。替换整包时使用 `skill-update`。
- 版本冲突时，重新读取当前版本及文件内容，核对用户的修改后再保存。目录发现的 Skill 直接编辑其原目录。

## MCP

- 用 `mcp-list` 与 `mcp-show` 确认同名连接和当前 `revision`。新建默认停用。stdio 需要启动命令，HTTP/SSE 需要实际服务地址；凭据在 Harness 连接器页面填写。
- 只提交用户要求的变更。提供 `args` 会替换全部启动参数。更新带凭据连接的执行程序或地址时，引导用户在连接器页面核对。
- 用 `mcp-test` 测试已保存配置。需要启用时再执行 `mcp-enable`。分别报告保存状态、测试结果和 `status`，只有 `status=connected` 表示当前连接可用。

写入与连接测试遵循会话授权。结果未知时先用 list 或 show 回查实际状态，确认后决定是否重试。外部 Agent 使用 Harness 导出的私有连接文件和随应用安装的 CLI，先用 `schema show` 查请求和结果格式。
