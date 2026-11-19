# Harness 内置工作台 CLI

[English](workbench-npm.md) | 中文

安装 ACTVERO Harness 即获得本机 CLI、工作台编译套件和开发 Skill。开发者和 Agent 可以创建项目、打包联调，也可以操作目标 Harness 的本机 Skill、MCP 和专家。

## 查找与启动

在 Harness 对话里调用 `workbench_cli_info`。外部 Agent 从「制作工作台」或「创建专家」的「交给其他 Agent」复制调用参数和目标开发连接文件。用返回的 executable 启动进程，固定 args 后追加子命令，env 只应用到这次调用。下文的 actvero-workbench 代表该调用前缀。

首次需要编译器的命令会校验并解压安装包自带的 kit.tgz 到 `~/.cache/actvero-workbench/`。使用 `info` 查询实际缓存目录、DSH 基线和工作台 API 版本。新项目运行 `create`，已有项目运行 `bind`。使用内置 CLI 的 `pack`、`check` 构建和检查。

## 查命令与自动化

从命令级 `--help` 查看用法，用 `schema list` 发现命令，用 `schema show` 查看参数、请求校验、结果字段、成功条件和回查方式。帮助、schema 和请求示例可离线读取。将示例的连接文件、ID、版本、路径和服务地址替换成本次操作的值。运行以下 MCP 示例前，先从目标 Harness 导出开发连接，并在请求文件中填写实际连接。

```sh
actvero-workbench mcp create --help
actvero-workbench schema list
actvero-workbench schema show mcp.create
actvero-workbench example show mcp.create > ./request.json
actvero-workbench mcp create --connection ./connection.json --file ./request.json --json
```

执行命令时加 `--json`，标准输出返回一行 JSON。成功时 `ok=true`，命令的返回数据在 `result` 中。失败退出码为 1，`error` 中包含 `code`、`message`、`outcome`，适用时包含 `recovery` 和字段级 `issues`。收到 `outcome=unknown` 时，先回查实际状态再决定是否重试。帮助和 schema 直接输出说明，`dev` 持续按行输出构建状态。

`skill install` 写入目标 Harness 的本机技能库。`skills install` 将本套件自带的四份内置 Skill 复制到指定 Agent 的技能目录。使用私有开发连接访问目标 Harness，连接文件由当前运行实例签发，重启后重新导出。

## 为 Agent 安装 Skill

新建项目携带工作台开发和前端两份 Skill。共享安装同时提供专家创建和本机能力管理 Skill。使用下面一条命令安装到共享目录或指定 Agent 目录；同名 Skill 已存在时拒绝覆盖。升级套件后使用 `actvero-workbench skills update --global`，仅替换本工具管理且未被修改的副本，保留用户自己的文件。

```sh
actvero-workbench skills install --global
actvero-workbench skills install "$HOME/.codex/skills"
```

`--global` 写入 `~/.agents/skills/`；不带路径时写入当前目录的 `.agents/skills/`。不同 Agent 的发现规则不同，复制文件不代表所有 Agent 都已加载；必要时直接提供输出目录中的 SKILL.md 路径，或在该 Agent 中重新加载技能。ACTVERO 桌面端自带的技能由桌面版本管理。

<a id="local-capabilities"></a>

## 管理本机 Skill 和 MCP

在 Harness 对话中，直接请 AI 安装或编辑指定的 Skill 或 MCP。AI 使用内置的 `local_capabilities` 工具，写入和连接测试走当前会话的工具授权。外部 Agent 使用同一组命令，从目标 Harness 的「交给其他 Agent」取得开发连接文件。

```sh
actvero-workbench skill list --connection /absolute/path/connection.json
actvero-workbench skill install /absolute/path/skill.zip --connection /absolute/path/connection.json
actvero-workbench mcp create --connection /absolute/path/connection.json --file ./mcp-create.json
```

`skill install` 接受目录、ZIP 或 SKILL.md。先用 `skill show` 的请求 `{"id":"本机 Skill ID"}` 获取版本和文件清单。用 `skill read` 读取指定文本文件，传 `id` 和包内 `path`。用 `skill edit` 更新一个现有文本文件，传 `id`、`version`、包内 `path` 和完整 `content`。需要替换整个包时用 `skill update`，将 `path` 指向新包的绝对路径。更新保留 Skill ID 和旧版本，过期的版本拒绝写入。`skill enable` 接受 `id` 和 `enabled`。

MCP 创建请求是 `{"config":{"name":"文档服务","transport":"http","url":"https://example.org/mcp"}}`，也支持 stdio 和 SSE。新建配置默认停用。用 `mcp show` 获取 `revision`，再用 `mcp update` 提交 `id`、`revision` 和只包含变更字段的 `patch`。已启用的连接更新后重新连接。`mcp test` 使用 `id` 测试并关闭临时连接，`mcp enable` 使用 `id` 和 `enabled` 保存启停状态。凭据在 Harness 的连接器页面输入，CLI 返回的摘要省略凭据、启动参数和完整 URL。带凭据的连接更换执行程序或地址时，请在连接器页面核对并编辑。

`skill help` 和 `mcp help` 列出当前命令。写入超时或被中断时，先用 list 或 show 查询实际状态再重试。目录发现的 Skill 通过其原目录编辑，`skill` 命令管理 Harness 安装的本机包。

## 更新、调试与交付

升级 Harness 后，对已有项目执行 `actvero-workbench bind /绝对路径/项目`，刷新工具链绑定、Skill 和类型配置，保留业务源码与 DESIGN.md。不要把旧缓存路径复制到另一台机器；在目标机器安装匹配套件后重新 bind。

`actvero-workbench dev <项目目录>` 自动构建。先运行 `actvero-workbench attach /项目目录 --connection /连接文件`，即可在目标 Harness 中加载临时开发覆盖；未连接时仅构建。通过 status、logs 和 detach 检查或结束覆盖。构建、加载与业务验收参见[开发指南](workbench-development.zh.md#create)。

卸载 Harness不会删除项目、已复制的 Skill 或缓存；仍被项目绑定的缓存需要保留。可用 info 获取缓存位置，在项目迁移到新版套件后再清理不用的旧目录。此套件不自动上传、发布或调用付费模型。

## 桌面交付

ACTVERO 桌面打包把 CLI 和匹配目标平台的编译套件放进应用资源。打包验收使用安装包自带的运行时读取 schema，并在隔离目录创建和打包示例工作台。CLI 随 Harness 升级。
