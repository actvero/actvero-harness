# 本地工作台开发

[English](workbench-development.md) | 中文

## 概述

本文面向已配置 Actvero 仓库开发环境的工作台开发者：从项目清单模板开始，修改业务界面，构建一个可导入桌面客户端的本地安装包。无需 GitHub 账号、仓库地址或发布服务。模板使用当前仓库的编译器；这里的命令在仓库根目录运行。

## 目录

- [创建和打包](#create)
- [导入和验收](#install)
- [包格式](#format)
- [修改业务](#business)
- [原生 AI 与共享数据](#native-ai)
- [组织运行配置](#runtime-config)
- [限制](#limits)

<a id="create"></a>

## 创建和打包

先按[客户端开发说明](workbenches.zh.md)准备仓库依赖。创建命令只接受尚不存在的目标目录，保护已有文件。第二个参数是稳定包名，同一个工作台后续版本保持包名不变。

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist
pnpm run actvero:workbench pack .artifacts/my-checklist .artifacts/workbenches
pnpm run actvero:workbench check .artifacts/workbenches/local-my-checklist-1.0.0.tgz
```

`create` 复制可编辑的项目清单；`pack` 编译 Host 和 Client、生成 bundle patch，并输出经过校验的 `.tgz`、字节数与 SHA-256。打包不修改业务源码，不执行安装或发布。输出文件同名时替换先前的构建产物；构建失败保留原产物。输出目录省略时使用项目的 `dist`。

`check` 复用客户端导入预检，并检查格式版本、版本声明、非空入口文件以及重复、越界和链接路径。它不执行工作台代码，不能证明业务功能正常。客户端还会在安装时执行当前运行版本的兼容性检查；开发命令不会跳过这一步。

<a id="install"></a>

## 导入和验收

启动 Actvero 开发客户端，打开「工作台 → 我的工作台」，点击「导入工作台」并选择输出包。若结果要求重启，使用「Harness → 重启 Harness」。成功加载后，卡片和左侧工作台切换菜单会出现「项目清单」。内置示例仍可用于参考；独立包的详情显示作者「本地开发」，以便区分。

打开独立包，勾选一项，返回管理页并重新打开，再刷新客户端后重新打开，检查进度仍在。检查预览图、侧栏展开/收起、浅色/深色以及窄窗口。首次打开不创建会话，也不要求指定工作区。安装结果、卡片出现、切换菜单与真实业务界面分别验收。

更新时保持包名不变，提高 `package.json.version`，重新打包。在卡片的「更多 → 更新版本」选择新包，或直接导入同名包；确认弹窗显示旧版本与新版本。同版本重复导入、降级、包名不符和运行时不兼容会被拒绝。替换成功显示「待重启」，重启 Harness 后检查「已加载」、版本与业务内容。已有独立存储数据不清除；业务数据结构变化由工作台自行迁移。

卡片的「更多」菜单可停用、启用或卸载。停用保留安装包，重启后仍在「我的工作台」中；只有加载成功的工作台进入侧栏切换菜单。卸载需要确认，保留独立存储的业务数据；重新导入同名包可恢复示例清单。安装或更新失败时查看错误详情并核对列表状态。不要把安装成功写成已完成业务验收。

<a id="format"></a>

## 包格式

格式标识为 `dsh.actveroWorkbench: 1`。交付物使用 npm 兼容 `.tgz`，内容位于 `package/` 目录；包大小不超过 8 MiB，解压内容不超过 32 MiB。稳定身份由 npm 包名承担，业务名称与版本在运行时注册时分别读取 `workbench.json` 和 `package.json`。

| 文件或字段 | 用途 |
|---|---|
| `package.json.name` / `version` | 稳定包名和完整 SemVer 版本；模板注册标识等于包名 |
| `engines.dsh` | 所支持的 DSH 运行时版本范围；模板锁定当前开发基线 |
| `dsh.bundle.patch` | 指向 `./cordis.patch.yml`，把包加入当前 Profile |
| `dsh.client` | 声明 Web 客户端及先加载的 `@actvero/dsh-capability-ui` 等依赖 |
| `dsh.actveroWorkbenchConfig` | 可选的运行配置字段，供组织管理员填写 |
| `exports["."]` / `exports["./client"]` | 本工具输出的 `./lib/index.js` 和 `./lib/client.js` |
| `exports["./locale/*.json"]` | 打包生成名称与介绍元数据，工作台未加载时仍可展示 |
| `workbench.json` | 源码中的名称、介绍、分类、作者和标签；编译时纳入客户端 |
| `src/client/assets/` | 源码预览图；通过图片导入编入客户端，不依赖远程图床 |
| `src/index.ts` | Host 插件入口；模板无 Host 业务服务 |
| `src/client/index.ts` | 使用 Cordis effect 注册卡片与业务组件，卸载时注销 |

构建产物包含清单、生成的 patch、展示用 `locale` 和编译后的 `lib`。`repository` 可以省略。React 使用宿主共享实例，CSS Modules 与图片使用仓库现有客户端编译器；不要把另一套 React 或宿主插件代码打入业务包。包校验是格式检查，不是代码沙箱。

<a id="business"></a>

## 修改业务

在 `workbench.json` 修改卡片文案；分类使用专家生态的统一标识：`office`、`engineering`、`design`、`content`、`data`、`education`、`lifestyle`、`general`、`uncategorized`。「我的工作台」不展示分类筛选，但包仍可携带分类。

在 `src/client/Checklist.tsx` 和相邻 CSS Module 修改业务视图，在 `locales.ts` 维护中英文案。在客户端入口声明预览图和可选 `iconUrl`；缺少图标时宿主显示默认图标。工作台注册接口见[客户端约定](../packages/actvero/capability-ui/src/contracts.ts)。业务内容占据主内容区，宿主保留公共导航与窗口控件。

示例按包名隔离浏览器本地存储，刷新后恢复清单；读取失败会显示错误并禁用修改，避免覆盖无法读取的数据。这里的存储属于当前客户端配置，不提供多项目、账户或组织隔离，也不提供备份。正式业务的数据管理需要独立设计。

<a id="native-ai"></a>

## 接入原生 AI 与共享数据

基础模板仅注册业务界面。需要原生对话时，在 Host 入口注入 `actveroWorkbenchRuntime`，以 `ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))` 注册与客户端相同的工作台标识。提供者声明初始 JSON、业务操作函数和给模型的操作说明，可携带名称、版本与指令组成的本地专家。专家使用会话所选模型，无需另配模型。可选准备函数失败会阻止绑定或后续模型请求；它不能把未记录的上下文偷偷加入模型请求。

组件收到 `workbench` 上下文，包含业务实例、关联会话、原生资源地址、打开对话、执行业务操作和读取公开账户信息的方法。`account()` 未登录时返回空，已登录时只返回用户及组织标识和名称；平台请求鉴权代理未接入，不要把这些公开字段当作凭据。`conversation()` 按需创建或恢复当前关联对话，`action()` 携带最新修订号保存。组件通过原生 `useResource` 读取数据，按自身容器宽度适配完整页和悬浮窗口。

Host 的每个工作台目前只有一个默认业务实例，多条关联对话共享数据。普通「新会话」不自动继承工作台；工作台内部「新建工作台对话」关联同一实例。恢复已有对话时读取日志中的关联和专家版本；收起浮窗不取消关联，取消使用不删除清单。业务文件由宿主在配置目录下管理，新建关联对话自动创建或复用以工作台命名的工作区并使用该目录，不要求用户选择文件夹。现有对话的目录保持原样。

可运行参考为[内置清单提供者](../packages/actvero/capability-ui/src/checklist.ts)及其[客户端](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx)。验收时分别检查首次无会话、同一清单的手动与工具修改、并发冲突、重新打开会话、取消关联、浮窗和窄窗口。安装和界面验收不替代真实模型及组织服务验证。

<a id="runtime-config"></a>

## 组织运行配置

需要服务地址等组织参数时，在安装包的 `package.json` 中声明 `dsh.actveroWorkbenchConfig`。每个版本最多声明 32 项，Key 必须唯一。新增或修改声明时，随新的工作台版本打包发布。

| 字段 | 格式 |
|---|---|
| `key` | 以大写字母开头，后续使用大写字母、数字或下划线，最长 64 字符 |
| `label` | 必填的后台显示名称，最长 80 字符 |
| `kind` | `text` 或 `url`，省略时为 `text`。URL 接受 HTTP 或 HTTPS |
| `required` | 布尔值，省略时为 `false` |
| `description` | 可选的填值说明，最长 240 字符 |
| `default` | 可选的非敏感默认值，最长 2048 字符，须符合字段类型 |

例如 `{"key":"CERTIFICATE_API_URL","label":"证照服务地址","kind":"url","required":true}`。管理员上传包后，在工作台详情的「运行配置」中填值。保持同一个 Key 可在升级时沿用组织的值。客户端组件调用 `await workbench.config()` 读取当前运行版本获准的字段，组织修改值后无需重新打包。读取需要桌面端登录和发布授权，失败时提示用户登录、重试或联系管理员。API Key 等凭据使用宿主的凭据服务。

<a id="limits"></a>

## 限制

开发工具在仓库内创建、构建和校验本地 `.tgz`。组织发布和成员安装见[客户端工作台说明](workbenches.zh.md)。业务请求的鉴权由工作台自行实现。专家、MCP 和 Skill 文件放入目录不会自动加载；内置专家指令和业务操作由 Host 提供者显式声明。

Actvero 工作台包通过 `ctx.actveroWorkbenches` 注册。已使用 `ctx.desktopWorkbenches` 的业务包请按[工作台迁移指南](../docs/upgrade-guide/v0.2.1-rc.3/actvero-dsh-workbench-removal/guide.zh.md)更新。
