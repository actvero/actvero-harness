---
name: develop-workbench
description: 为 ACTVERO Harness 创建、修改、调试和本地安装工作台，完成包校验、加载检查和业务验收；适用于自定义界面、可选 AI、随包专家及业务工具，不处理市场投稿或平台发布。
---

# 工作台开发

面向接手 ACTVERO 工作台项目的 Agent。按用户已确认的业务目标交付本地包，分别验证构建、安装、加载和实际业务。模板提供接入示例，不代表用户需求。

## 开始前

1. 沿用对话中已明确的需求；只追问缺少的关键业务目标或最小流程。范围不明时先只读检查，不创建业务代码或安装包。修复已有工作台时保留包名、数据和未提交修改，不重建项目、不重复确认已获授权的工作。
2. 加载 `reference/environment.json`，阅读指南的[开发环境](reference/guide.zh.md#environment)、[创建和打包](reference/guide.zh.md#create)、[包格式](reference/guide.zh.md#format)。其他章节按下表读取，无需一次读完整本手册。路径相对于本 Skill 的资源目录，不能假设当前目录就是 Skill 或源码仓库。
3. 核对独立开发套件或已构建源码工具链的位置及目标客户端/Profile。已有项目先查 `.actvero/toolchain.json`；缺失且上下文无法确定时询问套件位置。客户端内的 Skill 不包含完整编译器。独立套件无需 Harness 源码或 pnpm，不要求 GitHub 账号；不擅自克隆源码、安装其他运行时或改宿主配置。
4. `environment.json` 记录参考文档的 DSH 基线、工作台 API 版本与来源，不证明目标桌面已更新。包的 `engines.dsh` 与 `protocol.hostApi` 分别检查；不能改版本声明绕过不兼容。指南中标为“源码仓库”的路径不是随 Skill 安装的文件。

## 实现与调试

使用 [npm 发行版](reference/npm.zh.md)时，先运行 `actvero-workbench info` 获取已校验的工具链目录与版本，再用 `actvero-workbench create` 或 `bind`。Skill 安装只复制规范；当前 Agent 是否发现它需要单独确认。

通过 `actvero-workbench schema show <命令>` 查实参数、结果与回查方式，`example show <命令>` 获取请求样例。自动化命令使用 `--json`。写入结果未知时，按返回的 recovery 回查。联调时使用 `schema show dev` 区分生成归档、加载运行时和发布客户端。

新项目按指南运行 `create`，默认空白模板；仅需要示例时选 `plain` 或 `ai`。读取生成项目的 README.md、AGENTS.md 和 DESIGN.md，写明最小业务流程、首次入口、存储和验收点。已有项目直接修改。界面开发加载 `workbench-frontend` Skill，业务允许原生、品牌或自定义设计。

首次实现或架构不明时，读[实施手册](reference/implementation.zh.md#choose)：按数据与 AI 需求选方案，先打通一个业务操作。需要原生持久化时，跟随[完整示例](reference/implementation.zh.md#counter)连接 Host、Client 与资源更新；它是接入练习，不替代用户业务。接口或组件不确定时查[查找方法](reference/implementation.zh.md#lookup)，遇到问题按[分层排障](reference/implementation.zh.md#debug)收集证据。

在项目目录使用 `npm run doctor`、`npm run typecheck` 和相关业务测试。已提供 Harness 开发连接文件时，先执行 `actvero-workbench attach /绝对路径/项目 --connection /绝对路径/connection.json`，随后 `npm run dev` 自动构建并加载到此 Profile。`actvero-workbench status /项目目录` 和 `logs /项目目录` 返回部署记录，`detach /项目目录` 结束覆盖并恢复正式安装版本。未连接时 dev 仅构建。读取 `.actvero/diagnostics.json`，分别确认构建、Host 加载和 Client 发布；`runtime: loaded` 仍需在真实界面验证业务。更新等待关联对话空闲，失败保留或恢复上次可用实现；无法确认恢复时停止操作并查看诊断。CLI 不启动或重启 Harness。正式交付仍使用版本化打包与安装。工具链移动后按 README 执行 `bind`。

开启 `ai: true` 的工作台自动贡献一个随包专家，用户可从任意会话召唤。不要另外创建个人专家副本，不强制选择或切换文件工作区。可用 `expertEntry` 提供简介和头像，设为 false 隐藏入口。实例数据、对话文件目录与固定业务对象分别处理；沿用传入 sessionId 与 object，预览和完整界面指向相同业务对象。停用和卸载撤下专家入口，默认保留业务数据与历史。

按任务选读以下章节，再查对应真实接口；不要凭 API 名称猜参数。`reference/api/` 是只读接口副本，不能作为 SDK 安装。

| 需求 | 先读指南 | 接口与注意点 |
|---|---|---|
| 业务界面、布局与顶栏 | [修改业务](reference/guide.zh.md#business)、[显示控制](reference/guide.zh.md#display)、[顶栏](reference/guide.zh.md#header) | `reference/api/client.ts`；保留公共导航、主题、共享 React 与原生会话组件 |
| 持久化、初始化、迁移与卸载 | [存储](reference/guide.zh.md#storage)、[生命周期](reference/guide.zh.md#lifecycle) | `reference/api/provider.ts`、`reference/api/lifecycle.ts`；使用宿主 dataDirectory，清理由宿主确认，默认保留数据 |
| 原生 AI、专家与开发依赖 | [原生 AI](reference/guide.zh.md#native-ai)、[随包专家](reference/guide.zh.md#expert-bundle) | `reference/api/expert.ts`；显式连接 activate，验证资源绑定、取消和回收；沿用会话模型 |
| 对话与项目、文档绑定 | [业务对象](reference/guide.zh.md#conversation-objects) | `reference/api/provider.ts`；使用固定 object，不读全局 UI 选中项替代会话对象 |
| 选区引用与自动上下文 | [主动引用](reference/guide.zh.md#input-references)、[自动选区](reference/guide.zh.md#automatic-context) | `reference/api/workbench-reference.ts`；区分 conversation、reference 与 selection，保留原生发送和草稿流程 |
| 工具结果与历史跳转 | [业务结果](reference/guide.zh.md#business-results) | `reference/api/workbench-result.ts`；结果持久化，历史对象失效时明确反馈，不改写旧数据 |
| 设置与对话命令 | [设置和命令](reference/guide.zh.md#settings-commands) | `reference/api/client.ts`；按传入 sessionId 执行，卸载时清理注册 |
| 账号、模型目录与组织参数 | [身份与模型](reference/guide.zh.md#platform)、[运行配置](reference/guide.zh.md#runtime-config) | `reference/api/client.ts`、`reference/api/types.ts`；目录读取不代表图片、视频生成已接通，不暴露登录凭据 |

使用新能力前查 `reference/api/workbench-protocol.ts` 和对应章节的最低 API 要求，Host 与 Client 共用同一份声明。AI、MCP、CLI 和远程服务都是按需能力，不要求每个工作台实现全部功能。

实现顶栏时沿用 `header: Header` 注册接口，先读[顶栏](reference/guide.zh.md#header)。宿主负责左侧公共控件和窗口避让，工作台负责右侧业务内容；折叠侧栏不额外增加顶部安全行。不要为顶栏叠加窗口留白，也不在正文重复渲染同一套工作台导航。按实际容器宽度布局，并检查展开、折叠和全屏时的输入、菜单与业务状态保持。

## 安装与验收

先阅读[导入和验收](reference/guide.zh.md#install)及[故障定位](reference/guide.zh.md#verify)。只操作身份已确认的目标客户端/Profile；隔离开发客户端的结果不能算作日常应用验收。

- 发现当前可用工具并读取参数。原生 `plugin_manager` 可用时，先 `list_bundles` 核对目标，再用 `install_bundle` 安装校验后的绝对路径 `.tgz`，沿用原生授权。不要捏造安装工具。
- 更新保留包名、提高版本，使用支持版本替换的工具或管理页“更多 → 更新版本”；不以卸载重装绕过检查，不删除数据解决错误。
- 分别核对 `application` 安装结果与实际加载。`applied` 后继续查看界面；`restart-required` 只代表待重启；`failed`、`cancelled`、`overridden` 不算成功。未知结果先查询，避免重复操作。
- 不关闭或重启当前承载本轮任务的应用。需要重启时，任务结束后请用户使用“立即重启”或“Harness → 重启 Harness”；目标外的隔离客户端按已有授权使用正常重启流程。
- 核对管理卡片、侧栏入口和真实业务界面。`workbench_list` 只列 Host 提供者；`workbench_open` 返回 `confirmed` 只表示视图挂载，未知状态用 `workbench_status` 查询。UI-only 包按管理页和界面验证。

按实际能力执行指南自测表，包含最小业务流程及适用的数据保留、窄容器、明暗主题、会话隔离与失败恢复。模型调用、外部写入仍遵循用户授权；未调用真实模型时明确标记待验证，不把模拟结果写成真实验收。

故障在业务源码修复并重新打包，不直接修改安装缓存。目标工具和界面不可用时交付校验后的包，给出“工作台 → 我的工作台 → 导入工作台”入口，并说明尚未安装。

交付时说明完成的业务、实际包路径、执行过的检查、目标安装/加载状态和未验证项。按实际状态给出下一步操作，不默认要求重启。只做本地开发与安装；上传、发布或推送需另有明确授权。
