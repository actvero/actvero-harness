# 实施与保存

在用户确认方案后使用。先校对已确认的目标、需要写入的位置和获准的依赖。沿用现有 ID、版本和已确认的业务内容。

如果交付物是供别人导入的文件，按[专家文件与导入验证](import.md)制作和试导入；如果是直接写入目标，按下列路径操作。具体参数、返回值及调用示例见[作者工具手册](tools.md)。

## Harness 本机

1. 用 `expert_catalog` 回查候选的准确 ID 和当前就绪状态。按 `local-capability-manager` 的现有流程安装或更新 Skill、配置 MCP。需要用户自行授权的连接在客户端完成。
2. 有脚本时先在隔离样例上执行，确认输入、输出和文件影响。MCP 可用时做获准的连通或最小业务验证。保留用户未改动的绑定。
3. 新建用 `expert_create`，改造先用 `expert_list`、`expert_get` 读取配置和修订号，再用 `expert_update` 更新。将每项 Skill 准确标为必需或可选，并按实际使用时机设置 `always` 或 `on_demand`。
4. 用 `expert_get` 回读并用 `expert_check` 检查依赖。写入结果不明时先回查；遇到修订冲突先读当前版本。

### 保存中断后继续

收到 `AUTO_REVIEW_UNAVAILABLE` 表示这次调用没有执行。向用户说明停在哪一步、已经安装的 Skill ID、已生成头像的文件位置，请用户在本轮结束后发「重试」，或自行在权限菜单选择「工作区内修改」再继续。等待用户决定，停止调用其他工具。恢复时沿用已核实的资源，仅补做未完成步骤。遇到超时等结果不明的情况，先按名称用 `expert_list` 查找，再用 `expert_get` 核对版本、绑定和头像，确认缺少记录后才重新创建。

## 外部 Agent

优先用当前会话的原生作者工具。操作指定 Harness 时，使用其交接说明中的 CLI 可执行文件、固定参数、单次进程环境和私有连接文件。用 `schema list` 和 `schema show` 查询目标 CLI 当前支持的命令，再提交 `expert create` 或 `expert author-update`，并用 `expert author-get`、`expert author-check` 回读。需要安装或配置本机能力时，使用目标 CLI 的对应命令。连接或保存能力缺失时，交付可审查的专家与 Skill 文件，并写清实施状态。

## Actvero 中台

用户明确要求维护目标平台和组织时，参考当前可用的 `actvero-management` Skill 或 Actvero CLI 的操作指南。读取已授权的组织和现有版本。用实际结果中的 Skill 版本 ID、校验摘要和 MCP 能力标识建立绑定。按用户确认的范围保存草稿、试用或发布。必要的写入回查沿用原请求编号。

## 随工作台交付

需要专家操控本地工作台时，读取绑定的 `develop-workbench` Skill 中随包专家与 CLI 指南。工作台、专家、Skill 和脚本共享同一业务版本和已确认的数据目录。用目标客户端的命令清单确认安装及更新方式，核对实际运行时。新版 CLI 提供 `update` 时，在开发完成后按确认的目标 Profile 应用一次，再查看 `status` 和工作台界面。
