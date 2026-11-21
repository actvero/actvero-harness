# 专家作者的工具手册

先看当前会话实际暴露了哪些工具，再选择对应入口。设计阶段做访谈、读资料、查目录。收到用户对方案的确认后，才执行方案涉及的安装、配置、业务测试和保存。把专家每次处理业务所需的 Skill 和连接器绑定给它。提问、搜索候选、管理本机和制作头像通常只在设计期间使用。

## 访谈、素材与进度

| 工作 | Harness 调用 | 拿结果后怎么做 |
| --- | --- | --- |
| 需求访谈、决定权限、确认方案 | `ask_user_question`，例如 `{"questions":[{"id":"output","question":"这份简报最后给谁使用？"}]}`。需要选项时用 `options:[{"label":"销售同事"},{"label":"管理层"}]` | 按 `answers[].id` 读取 `selected` 或 `custom`。若为 `pending`，保留未决事项。其他宿主用其提问工具，只有普通对话时直接提问 |
| 跟踪长任务 | `todo_write`，条目为 `{"content":"核实候选连接器","status":"in_progress"}`，放在 `todos` 数组中 | 每次提交完整待办列表。状态用 `pending`、`in_progress`、`completed` |
| 读取技能或样稿 | `skill({"name":"会话目录中的准确名称"})`，或 `read({"file_path":"用户提供的文本路径"})` | 从返回的 `content` 理解 SOP，按实际 `resourceBase` 打开被引用文件。安装管理目录的读取办法见下表 |
| 查公开来源并读原文 | `web_search({"queries":["新闻稿 引语 核查 写作指南"]})`，再对候选原文用 `web_fetch({"url":"实际返回的网址"})` | 记下来源、版本或提交号和能复用的具体步骤。宿主只提供浏览器或其他联网工具时使用同等能力 |
| 制作头像 | 从当前会话工具声明查能生成并返回或保存图片的真实操作 | 在方案确认时按下方头像分支提问，选择生成后才调用图像工具 |

## 专家头像

确认方案时看 **当前会话已暴露的工具**。核对声明是否支持从文字生成图片并返回可读取的文件或图像数据。有图像生成 Skill 时，继续核对它依赖的实际工具。只能读取图片、搜索图片，或仅在中台目录看到未连接的生图服务，都走下表第二行。

| 当前能力 | 向用户提问「专家头像怎么设置？」的选项 |
| --- | --- |
| 有可调用的图像生成工具，能取回结果 | 生成头像 ／ 我提供图片 ／ 使用默认头像 |
| 没有可用的图像生成工具 | 我提供图片 ／ 使用默认头像 |

用宿主提问工具呈现一个单选问题。头像与是否实施是独立选择。用户已明确选择或已交付头像时，直接处理该分支。

- **生成头像**。按已确认的专家职责生成适合小尺寸展示的方形头像，取得实际图像。若工具失败，说明原因，再让用户选择重试、提供图片或使用默认。单次制作头像所用的工具无需绑定到业务专家。
- **我提供图片**。使用用户明确指定的附件或本机图片；还没有图片时，请他上传或给出可读路径，再继续处理头像。遇到损坏或无法读取的图片时请其重新提供。不要擅自改为生成或默认。
- **使用默认头像**。原生新建时省略 `avatarPath`，制作清单时省略 `manifest.avatar`，客户端显示默认头像。修改已有专家时，用户明确选「使用默认头像」才清空旧头像；只修改其他内容时省略 avatar 字段以保留原图。

原生新建时，把会话可读的 PNG、JPEG 或 WebP 文件路径传给 `avatarPath`。工具读取并保存图片，回读 `expert_get.hasAvatar` 应为 true。通过 CLI、更新接口或导入文件交付时，将同一图片的完整 base64 data URL 写入 `manifest.avatar`。两种入口的编码上限均为 500,000 个字符。超限先缩图。

## 本机专家

下表原生工具返回 JSON 文本。外部 Agent 的列是随桌面端安装的 CLI 子命令，调用前缀和文件约定见下一节。

| 任务 | Harness 原生工具与入参 | 桌面 CLI 与请求文件中的字段 | 读取或写入结果 |
| --- | --- | --- | --- |
| 查可绑定的 Skill、MCP | `expert_catalog({})` | `expert catalog`，无文件 | 只读。返回 `skills[]`、`connectors[]` 的 `id/name/description/ready`。名称或中台 ID 均不能直接代替这里的本机 ID |
| 找已有专家 | `expert_list({"query":"新闻","page":1})` | `expert author-list`，可传 `{query,page}` | 只读。每页最多 50 条，返回 `items`、`total`，选取目标 ID |
| 读取配置 | `expert_get({"id":"实际专家ID"})` | `expert author-get`，传 `{id}` | 只读。返回 `manifest`、`bindings`、`revision`、`hasAvatar`。回读省略头像正文 |
| 创建本机专家 | `expert_create({name,description,instructions,skills,connectors,avatarPath})`（示例见下） | `expert create`，文件为 `{"expert":{"manifest":…,"bindings":…}}` | 写入。记录 `manifest.id` 和 `revision` |
| 改造已有专家 | `expert_update({id,revision,changes:JSON.stringify(patch)})` | `expert author-update`，传 `{id,revision,patch}` | 写入。返回更新后的 ID 和修订号。只传变化字段，提交的数组或 `bindings.skills/connectors` 子映射会整组替换。冲突时重读目标，核对差异后重试 |
| 验证依赖就绪 | `expert_check({"id":"实际专家ID"})` | `expert author-check`，传 `{id}` | 返回 `ready`、`warnings`、`missing`。继续在新会话里召唤专家，使用样例验证业务结果 |

#### Harness 原生创建示例

以下是新闻稿专家的工具入参示例。把示例 ID 换成目标会话 `expert_catalog` 返回的准确 ID，把路径换成已经取得的文件。所选专家不使用 MCP 时可省略 `connectors`。

```json
{
  "name": "新闻稿编辑",
  "description": "把活动资料整理成可核实的提纲，编辑确认后撰写新闻稿。",
  "instructions": "先交提纲并标记数字或引语冲突，等编辑确认后再成稿。",
  "skills": [{"id": "local-example-newsroom", "load": "always"}],
  "avatarPath": "assets/newsroom.webp"
}
```

必选字段为 `name`、`description`、`instructions`。每个 Skill 传 `id` 和 `load`，每个 MCP 传 `id`，两者均可用 `required: false` 表示可选。工具生成专家 ID、初始版本、清单版本和依赖绑定。字段错误时按报告的位置修正。若连接到旧版 Harness，以实际工具声明为准；仅提供 `configuration` 的旧版需要用完整的 `{manifest,bindings}` JSON 字符串。其 `manifest` 必须含 `schemaVersion: 1`、`version: "1.0.0"` 及依赖声明，`bindings` 按声明的 key 映射到本机 ID。

## 外部 Agent 调用桌面端

从目标 Harness 的交接说明取 `executable`、固定 `args`、单次进程 `env` 和私有连接文件路径。原生会话可用 `workbench_cli_info({})` 查启动信息。按参数数组追加以下命令。每行是独立的一次调用，`$CONNECTION` 表示目标连接文件路径。路径中有空格时保留为单个参数。

```sh
schema list
schema show expert.create
example show expert.create
expert catalog --connection "$CONNECTION" --json
expert create --connection "$CONNECTION" --file ./create-request.json --json
expert author-get --connection "$CONNECTION" --file ./expert-id.json --json
expert author-check --connection "$CONNECTION" --file ./expert-id.json --json
```

把 `example show expert.create` 的输出用作请求骨架，填入已确认的方案和本机目录 ID。`expert-id.json` 只含返回的专家 ID，例如 `{"id":"从创建结果复制的ID"}`。机器输出成功时读 `ok` 和 `result`，失败时读 `error.code/issues/recovery`。`error.outcome=unknown` 时先按名称查询、再按 ID 回读核实，避免重复创建。缺开发连接时仍可交付可导入文件；在没有保存回执时，将本机状态标为「待导入」。

## 本机 Skill 和自定义 MCP

在 Harness 加载 `local-capability-manager`。使用 `local_capabilities({operation,input_json})`，其中 `input_json` 是右表参数的 **JSON 字符串**，列表操作可省略。例如 `{"operation":"skill-read","input_json":"{\"id\":\"实际安装ID\",\"path\":\"SKILL.md\"}"}`。外部 Agent 将操作名拆成两个子命令，例如 `skill-read` 对应 `skill read`。传 `--connection <路径> --json`，需要参数时把同一个参数对象直接写入 `--file <请求.json>`，不含 `operation`。

| 操作 | 参数字段 | 返回信息与影响 |
| --- | --- | --- |
| `skill-list`、`skill-show`、`skill-read` | 分别为 `{}`、`{id}`、`{id,path}` | 查安装 ID，再查 `version`、`files[].path/sha256`，最后读所选文件的 `content` |
| `skill-install`、`skill-update` | `{path}` 或 `{id,version,path}`，path 为本机绝对路径 | 安装目录、ZIP 或入口文件。多文件 Skill 传完整目录或 ZIP。更新用 show 返回的版本并保留旧版 |
| `skill-edit`、`skill-enable` | `{id,version,path,content}` 或 `{id,enabled}` | 前者用完整文本替换包内单个文件，后者保存启停状态。完成后用 show/read 回读 |
| `mcp-list`、`mcp-show` | `{}` 或 `{id}` | 得到配置摘要、`revision`、`enabled` 和运行 `status`。具体业务工具签名从实际会话工具声明或服务文档取得 |
| `mcp-create`、`mcp-update` | `{config:{name,transport,…}}` 或 `{id,revision,patch}` | stdio 传真实 `command` 和所需 `args`，http/sse 传真实 `url`。新配置默认关闭，修改已启用连接可能重连。凭据在客户端填写 |
| `mcp-test`、`mcp-enable` | `{id}` 或 `{id,enabled}` | 测试会临时启动程序或连接服务，并返回 `connected`。开启后用 show 检查 `status=connected`，再在获准范围试一个业务调用 |

## 在 Actvero 中台查现成能力

使用独立的 `actvero` 平台 CLI，并明确目标服务器和组织。`$SERVER`、`$ORG`、`$SKILL_ID`、`$VERSION_ID` 和 `$MCP_ID` 都来自目标环境。用 `actvero --version` 和各命令的 `--help` 核对当前客户端。以下是只读调研命令。

```sh
actvero experts dependencies --kind skills --q "新闻稿" --server "$SERVER" --org "$ORG" --json
actvero experts dependencies --kind connectors --q "文档" --server "$SERVER" --org "$ORG" --json
actvero skills list --q "写作" --server "$SERVER" --org "$ORG" --json
actvero skills show "$SKILL_ID" --server "$SERVER" --org "$ORG" --json
actvero skills files "$SKILL_ID" --version-id "$VERSION_ID" --server "$SERVER" --org "$ORG" --json
actvero skills file "$SKILL_ID" --version-id "$VERSION_ID" --path "$PACKAGE_PATH" --server "$SERVER" --org "$ORG" --json
actvero mcp list --server "$SERVER" --org "$ORG" --json
actvero mcp capabilities "$MCP_ID" --server "$SERVER" --org "$ORG" --json
```

`experts dependencies` 用于搜索专家可引用的版本和连接器。`skills files` 返回指定版本的概览文本，读取单个文件时从 `skills show` 对应版本的 `files` 清单选取 `$PACKAGE_PATH`。`mcp list` 可在本地按名称筛选。`mcp capabilities` 读取此前发现的工具、提示词和资源。目录为空时标明「工具待核实」。`mcp discover` 会实际连接并刷新目录，`mcp run` 可能产生业务写入。访问组织失败时记录缺少的平台、组织或权限，继续本机和公开渠道调研。

只有交付目标是平台专家时，按平台 `ExpertSave` 或 `ExpertUpdate` schema 提交草稿。`experts create --file` 或 `experts update <id> --file` 成功后用 `experts show <id>`、`experts check <id>` 回查。带上相同的服务器、组织和写操作的 `--request-id`，结果未知时用 `commands show <request-id>` 查询。发布另有 `experts publish`，适用于用户要求发布的任务。

## 搜公开 Skill 和 MCP

- **按业务目标找 Skill。** 宿主已提供 `find-skills` 时加载它，或运行 `npx skills find "press release"`。打开候选仓库的实际 `SKILL.md`，核对引用的模板、脚本、发布版本或 commit，以及许可。为用户写明复用哪条 SOP、改写哪项业务口径。没有终端时用联网搜索定位原仓库。[Skills CLI 搜索说明](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#skills-find)
- **按服务名找 MCP。** 用 `web_fetch` 或下列命令查官方 Registry。从记录取 `server.name`、`server.version` 及仓库或厂商文档地址。名称搜索至少三个字符，`version=latest` 也可能返回已弃用版本，检查状态。按任务搜索效果不佳时先用 `web_search` 找具体产品，再查该产品的服务和工具签名。[官方 MCP Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md)

```sh
curl -fsSG 'https://registry.modelcontextprotocol.io/v0.1/servers' \
  --data-urlencode 'search=github' --data-urlencode 'version=latest'
```

**业务工具要具体到一次调用。** 例如技术新闻稿需要读取确定版本的发布说明。GitHub 官方 MCP 的 `get_file_contents` 接收 `owner`、`repo`、`path`，可用 `sha` 固定提交。输入是用户授权仓库、提交和稿件资料路径，输出是文件内容。向用户展示时可写「读发布材料，限定指定仓库，缺权限时接收上传的 Markdown」。发布者文档只支持「候选」判断。运行时用目标会话实际注册的工具名和参数，记录一次只读试跑后再标「已实测」。[GitHub MCP 官方工具目录](https://github.com/github/github-mcp-server#tools)

形成方案时，每个实际业务工具占一行，列出具体操作名、输入、返回给哪一步、权限、来源与状态、失败后的动作。仅参考的 Skill 列出来源和借鉴部分。公开目录的名字、中台 UUID 和本机安装 ID 各自在对应环境使用，最终绑定以目标端的实际回查为准。
