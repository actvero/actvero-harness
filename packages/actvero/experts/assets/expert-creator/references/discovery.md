# 查找与核实能力

在需求和代表案例清楚后使用。根据真实工作步骤搜索。例如搜索「只读检索组织文档并返回原文链接」或「活动新闻稿事实核对与审稿流程」。

准确调用、返回字段和权限见[作者工具手册](tools.md)。

## 渠道一　现有能力

1. 先看当前会话可用的原生工具和专用 Skill。文件读取、表格处理、联网搜索和本地 CLI 已能完成某一步时，记录可直接复用。
2. 在 Harness 用 `expert_catalog` 查看可绑定的本机 Skill 和已配置 MCP。外部 Agent 可先用 `schema show expert.catalog` 查看接口，再通过 `expert catalog --connection "$CONNECTION" --json` 读取该设备的实际目录。用当前可用的 Skill 查看工具或 `skill show`、`skill read` 读候选文件。用连接器详情核对实际连接、读写能力和就绪状态。
3. 查当前已授权的 Actvero 中台组织。优先用 `actvero experts dependencies` 搜索可供专家引用的依赖，按类型分别传 `--kind skills` 或 `--kind connectors`，并传关键词、服务器和组织。需要扩大范围时用 `actvero skills list --q <关键词>` 或 `actvero mcp list`，再用 `actvero mcp capabilities <ID>` 读取工具目录。用当前 Actvero CLI 帮助核对平台地址、组织和参数。分别记录工具是否已经就绪、用户是否可申请连接、目录是否可见。

## 渠道二　公开目录与联网搜索

1. 优先使用当前已经提供的 Skill、MCP 搜索工具。搜索 Skill 可用 `find-skills` 或 `npx skills find <关键词>`。搜索 MCP 可查询官方 MCP Registry 或 GitHub MCP Registry。官方 Registry 的 `search` 按服务名称匹配。要按任务或工具能力找时，可以用普通联网搜索找到厂商文档，再回查服务。
2. 文档索引、专业 SOP、规则模板等内容可作为搜索切入点。例如新闻稿可以分别查「活动新闻稿导语」「引语和数据事实核对」「机构稿件模板」。打开候选的实际 `SKILL.md`、参考文件和脚本说明，判断覆盖了哪几步。
3. 选择小量有代表性的候选。核对发布者、来源链接、依赖、适用场景和许可。合适的整包可以复用。需要适配时，记录计划改动的规则或模板。仅适合借鉴方法时，提炼其思路，再按照用户的业务样例编写自己的 Skill。
4. 核对候选 MCP 提供的具体工具、参数、读写范围、权限和结果。比如「支持文档」要进一步核对是否能按组织空间搜索和读取正文、是否返回原文链接、是否需要 OAuth。目录说明用于形成方案，连接和业务调用在获得对应授权后验证。

可参考 [Skills CLI 搜索命令](https://github.com/vercel-labs/skills/blob/main/docs/commands.md#skills-find)、[官方 MCP Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md)和 [GitHub MCP Registry](https://github.com/mcp)。

## 为方案留下可判定的信息

| 记录项 | 实际要回答的问题 |
| --- | --- |
| 关联步骤 | 这个能力完成哪一步，输入和返回值是什么 |
| 来源与证据 | 当前本机、当前组织或公开目录。附真实标识、版本或出处 |
| 使用决定 | 直接复用、适配后复用、仅参考、需要新建 |
| 可用状态 | 可直接用、待安装、待授权、待核实、不可访问 |
| 权限和替代 | 用到哪些数据、可做什么操作，缺失时如何继续 |

在方案中展示影响用户决策的内容。有一项成熟能力已经足够时保留它，并讲清其覆盖范围。没有适合的候选时，说明查到了什么、差在哪一步，再选择用原生工具、自建小 Skill，或保留人工步骤。
