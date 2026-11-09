# 工作台开发

[English](workbench-development.md) | 中文

## 概述

本文面向工作台开发者与接手项目的 Agent：创建本地开发目录，按业务与视觉方案开发，校验并打包，再到目标客户端安装和验收。无需 GitHub 账号、仓库地址或发布服务。初始化使用已构建的 ACTVERO 源码工具链，之后在生成的项目目录运行开发命令。

## 目录

- [开发环境与任务入口](#environment)
- [创建和打包](#create)
- [导入和验收](#install)
- [包格式](#format)
- [修改业务](#business)
- [运行目录与自定义存储](#storage)
- [原生 AI 与共享数据](#native-ai)
- [随包专家、Skill、MCP 与 CLI](#expert-bundle)
- [显示控制与 Agent 入口](#display)
- [身份与平台模型目录](#platform)
- [本地自测与故障定位](#verify)
- [限制](#limits)

<a id="environment"></a>

## 开发环境与任务入口

本指南随原生 `develop-workbench` Skill 分发时，`reference/environment.json` 记录同次构建的 DSH 基线、工作台格式、能力包版本与参考文件来源。`reference/api/` 是接口源码的只读副本，用于核对参数，不是可安装的 SDK。指南链接到未随包分发的资料时，会标明其源码仓库路径。先核对目标客户端实际版本；源码基线或本快照不能证明另一个客户端具备相同能力。

先从当前项目或用户已提供的位置找到 ACTVERO 源码根目录，确认其中存在 `scripts/actvero-workbench.client.ts`、`actvero/upstream.lock.json`、`actvero/templates/` 和根 `package.json` 的 `actvero:workbench` 命令；不要把业务输出目录当工具链根目录。在该根目录检查以下命令，并将版本与根 `package.json` 的 `engines`、`packageManager` 比较。构建依赖未准备好时按仓库说明安装，不创建替代宿主或独立 Agent 引擎。

```sh
node --version
pnpm --version
```

需求已经明确的修改任务直接读取已有源码；新建任务才使用 `create`。只知道名字或目录、尚无业务目标时先确认最小流程。源码目录与安装客户端分别确认：安装到隔离开发 Profile 不等于安装到日常应用。源目录可以在仓库之外，下面的相对输出路径仅为示例；实际操作使用已确认的路径，含空格时引用整个路径。找不到工具链时询问其位置，不能据此声称只凭已安装客户端就能编译。

<a id="create"></a>

## 创建和打包

也可在管理页点击「制作工作台」，复制说明并在新对话补充业务目标。原生 `develop-workbench` Skill 随客户端提供，引用构建时从本文生成的指南；它不会自动决定业务内容或发送任务。当前开发命令需要源码仓库和已安装依赖，客户端尚未附带独立编译器。

先按[客户端开发说明](workbenches.zh.md)准备仓库依赖，并在仓库根目录执行 `pnpm run build:artifacts` 生成当前接口的类型产物。创建命令只接受尚不存在的目标目录，保护已有文件。可选的第二个参数是稳定包名；省略时根据初始路径生成并保存本地包名，移动目录后仍保留该名称。

```sh
pnpm run actvero:workbench create .artifacts/my-workbench @local/my-workbench
cd .artifacts/my-workbench
npm run doctor
npm run typecheck
npm run build
npm run check
```

需要清单示例时，在仓库根目录显式选择：

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist --template plain
pnpm run actvero:workbench create .artifacts/my-ai-checklist @local/my-ai-checklist --template ai
```

`create` 默认生成可编译的空白界面，不预设业务或启用 AI。`plain` 是浏览器存储清单，`ai` 是带原生数据、AI 和本地专家 Skill 的「AI 项目清单」。示例均可免登录使用本地功能；模板不代表用户的业务需求。

生成目录含 README.md、AGENTS.md、DESIGN.md、构建脚本、类型配置与两份 Skill。先确认最小业务流程，在 DESIGN.md 记录首次入口、存储、AI、页面与验收点。独立的「工作台前端规范」支持原生、品牌或自定义风格，公共组件与主题优先复用；个性化选择记录原因即可。项目说明让后续 Agent 能找到资料，无需重新猜测开发方式。

`doctor` 检查声明、入口和运行时基线，提醒未完成的设计项；`typecheck` 用当前工具链构建的声明检查作者代码。`build` 与 `pack` 均先检查类型，再编译 Host 和 Client、生成 bundle patch，输出经过校验的 `dist/*.tgz`、字节数与 SHA-256。构建不修改业务源码、不安装或发布；失败保留原产物。`check` 默认复核 dist 中唯一的包；多个版本时运行 `npm run check -- /绝对路径/包.tgz`。业务测试由作者按需求添加。

这些命令依赖 `.actvero/toolchain.json` 中绑定的源码目录，尚非独立 SDK。此文件与生成的 tsconfig.json 不提交；项目移动或换机器后，在项目内执行 `node scripts/workbench.mjs bind /绝对路径/actvero-harness`。重新绑定刷新编译配置、两份 Skill 与接口快照，保留业务代码、README.md、AGENTS.md 和 DESIGN.md。.actvero/skills 供 Agent 明确读取，不假设其他 Agent 产品会自动发现。

`check` 复用客户端导入预检，并检查格式版本、版本声明、非空入口文件以及重复、越界和链接路径。它不执行工作台代码，不能证明业务功能正常。客户端还会在安装时执行当前运行版本的兼容性检查；开发命令不会跳过这一步。

已有源码也可在仓库根目录使用 `pnpm run actvero:workbench doctor <目录>`、`typecheck <目录>`、`pack <目录> [输出目录]` 和 `check <包.tgz>`；缺少项目配置时使用当前基线的类型配置。更新时保留包名和数据，提高 `package.json.version`；Host 与 Client 从该文件读取版本。安装使用命令输出的绝对 `path`。结构、类型与归档检查不证明业务、专家依赖或安装已通过验收。

<a id="install"></a>

## 导入和验收

启动目标 Actvero 客户端，打开「工作台 → 我的工作台」，点击「导入工作台」并选择输出包。若结果要求重启，使用「Harness → 重启 Harness」。成功加载后，卡片和左侧切换菜单显示 workbench.json 中的名称；默认空白模板显示「空白工作台」。

Agent 先发现当前目标提供的安装工具并读取参数。目标若提供专用本地安装工具，按其实际约定调用。原生 `plugin_manager` 的 `list_bundles` 可核对当前 Profile 清单，`install_bundle` 接受已校验 `.tgz` 的绝对路径，可用于首次安装并沿用原生授权；当前通用工具不接受管理页的已审阅版本替换参数，更新应使用支持替换的专用工具或管理页。不要捏造工具，也不要用卸载重装绕过更新检查。工具和界面均不可操作时交付包并明确待安装。

安装结果的 `application` 为 `applied` 时继续核对加载；`restart-required` 表示已保存但待重启；`failed`、`cancelled`、`overridden` 均不代表已生效，未知结果应重新查询。Agent 运行在目标应用中时不自行关闭、重启或探测进程来管理重启；提示用户等本轮结束后使用顶部「立即重启」或「Harness → 重启 Harness」。用户可直接试用，也可回原对话说「重启好了」继续验收。目标外的隔离开发客户端按已有授权采用正常重启流程。

打开工作台执行真实业务流程；有持久化时返回管理页、重新打开并刷新，检查数据保留。清单示例可勾选一项验证。检查预览图、侧栏展开/收起、浅色/深色以及窄窗口。默认空白模板首次打开不创建会话，不要求指定工作区。安装结果、卡片、切换菜单与真实业务界面分别验收。

更新时保持包名不变，提高 `package.json.version`，重新打包。在卡片的「更多 → 更新版本」选择新包，或直接导入同名包；确认弹窗显示旧版本与新版本。同版本重复导入、降级、包名不符和运行时不兼容会被拒绝。替换结果要求重启时显示「待重启」；重启 Harness 后检查卡片的打开入口、版本与业务内容。已有独立存储数据不清除；业务数据结构变化由工作台自行迁移。

卡片的「更多」菜单可停用、启用或卸载；已加载且原生文件管理器可用时，还可打开宿主管理的数据文件夹。停用与卸载需要确认，保留本地数据目录和历史对话。停用保留安装包，重启后仍在「我的工作台」中；只有加载成功的工作台进入侧栏切换菜单。卸载后重新导入同名包可恢复示例清单。修改安装状态前检查关联对话，仍在运行或状态无法确认时暂不执行。安装或更新失败时查看错误详情并核对列表状态。不要把安装成功写成已完成业务验收。

<a id="format"></a>

## 包格式

工作台扩展 API 与 DSH 运行时版本分别检查：当前扩展 API 为 `1.3.0`，声明格式为 `schemaVersion: 1`。模板将 `protocol` 放在 workbench.json；新增 Host 提供者时也传入 `protocol: metadata.protocol`，Client 继续读取相同元信息。旧包省略声明时，统一按原始 API `^1.0.0` 解析，不随宿主升级自动接受新 API。格式无效、未知字段、未支持的声明版本或不兼容的 API 范围会在注册前拒绝。doctor、pack、check 和客户端导入预检检查兼容性；实际 Host/Client 注册仍各自校验，归档检查不能替代真实加载。

格式标识为 `dsh.actveroWorkbench: 1`。交付物使用 npm 兼容 `.tgz`，内容位于 `package/` 目录；包大小不超过 8 MiB，解压内容不超过 32 MiB。稳定身份由 npm 包名承担，业务名称与版本在运行时注册时分别读取 `workbench.json` 和 `package.json`。

| 文件或字段 | 用途 |
|---|---|
| `package.json.name` / `version` | 稳定包名和完整 SemVer 版本；模板注册标识等于包名 |
| `package.json.type` | 必须为 `module`，Host 与 Client 使用 ESM |
| `package.json.icon` | 可选的包内图标，例如 `./assets/icon.svg`；支持 SVG、PNG、JPEG、WebP，文件不超过 256 KiB |
| `engines.dsh` | 所支持的 DSH 运行时版本范围；模板锁定当前开发基线 |
| `workbench.json.protocol` | `schemaVersion: 1` 与所需 API 范围；使用顶栏接口时为 `hostApi: "^1.1.0"`；Host 和 Client 注册均读取这份声明 |
| `dsh.actveroWorkbenchProtocol` | 打包时从上述声明生成，客户端导入预检和 check 校验同一宿主 API 要求 |
| `dsh.bundle.patch` | 指向 `./cordis.patch.yml`，把包加入当前 Profile |
| `dsh.client` | 声明 Web 客户端及先加载的 `@actvero/dsh-capability-ui` 等依赖 |
| `exports["."]` / `exports["./client"]` | 本工具输出的 `./lib/index.js` 和 `./lib/client.js` |
| `exports["./locale/*.json"]` | 打包生成名称与介绍元数据，工作台未加载时仍可展示 |
| `workbench.json` | 源码中的名称、介绍、分类、作者和标签；编译时纳入客户端 |
| `src/client/assets/` | 源码预览图；通过图片导入编入客户端，不依赖远程图床 |
| `src/index.ts` | Host 插件入口；模板无 Host 业务服务 |
| `src/client/index.ts` | 使用 Cordis effect 注册卡片与业务组件，卸载时注销 |

构建产物包含清单、生成的 patch、展示用 `locale`、编译后的 `lib` 以及可选的 `assets` 原始资源。`repository` 可以省略。React 使用宿主共享实例，CSS Modules 与图片使用仓库现有客户端编译器；不要把另一套 React 或宿主插件代码打入业务包。包校验是格式检查，不是代码沙箱。

新建模板的编辑位置如下；`cordis.patch.yml`、`lib/` 和展示用 `locale/` 由打包工具生成，不在安装目录中手改。

```text
my-workbench/
├── package.json                    # 稳定身份、版本、依赖、入口、可选 icon
├── workbench.json                  # 名称与简介必填，分类/作者/标签可选
├── README.md / AGENTS.md            # 开发命令与 Agent 入口
├── DESIGN.md                       # 已确认业务、视觉方案与验收记录
├── scripts/workbench.mjs           # 调用绑定的源码工具链
├── tsconfig.json                   # 生成的本机类型配置，不提交
├── .actvero/toolchain.json         # 本机绑定，不提交
├── .actvero/skills/                # 工作台开发、工作台前端规范与接口快照
├── src/index.ts                    # Host 注册；纯界面模板为空入口
├── src/client/index.ts             # 注册业务组件、语言、预览和显示建议
├── src/client/                     # 自行组织业务组件、文案与样式
├── src/client/assets/              # 可选预览图片，使用 import 引入
└── assets/                         # 可选原始资源，原样随包复制
    ├── icon.svg
    ├── expert.json
    ├── dependencies.json
    ├── skills/<key>/SKILL.md
    ├── mcp.json
    └── cli.mjs
```

<a id="business"></a>

## 修改业务

在 `workbench.json` 修改卡片文案；分类使用专家生态的统一标识：`office`、`engineering`、`design`、`content`、`data`、`education`、`lifestyle`、`general`、`uncategorized`。「我的工作台」不展示分类筛选，但包仍可携带分类。

在 `src/client/` 组织业务组件与 CSS Module，并用语言字典维护中英文案；清单示例的入口为 Checklist.tsx 和 locales.ts。在客户端入口声明预览图。图标放入包根目录的 `assets/`，在 `package.json` 声明一次，例如 `"icon": "./assets/icon.svg"`；宿主会在卡片、详情、切换菜单、业务标题、对话选择器、输入框标签和悬浮工作台按钮中复用它。图标缺失或加载失败时显示默认图标。未声明包图标时兼容客户端的 `iconUrl`。管理入口与 AI 助手保留宿主图标。工作台注册接口见[客户端约定](../packages/actvero/capability-ui/src/contracts.ts)。业务内容占据主内容区，宿主保留公共导航与窗口控件。

示例按包名隔离浏览器本地存储，刷新后恢复清单；读取失败会显示错误并禁用修改，避免覆盖无法读取的数据。这里的存储属于当前客户端配置，不提供多项目、账户或组织隔离，也不提供备份。正式业务的数据管理需要独立设计。

<a id="header"></a>

### 自定义顶栏与共享视图状态

从扩展 API `1.1.0` 起，注册可传入 `{ locale: namespace, header: Header, store: navigationStore }`。`header` 和 `store` 均可省略。宿主只保留返回工作台列表、分隔线、侧栏及窗口控制；分隔线右侧由 Header 完整渲染，不额外插入图标、工作台名称、面包屑、下拉菜单或操作。未提供 Header 时显示最小的工作台图标与名称。预览只渲染正文，不挂载顶栏；注册释放时同时移除卡片、正文和顶栏。

Header 使用 `WorkbenchHeaderProps`，获得作为参考的 title、与正文相同的 workbench 和原生资源读取接口，直接返回作者的 React 内容。开发者自行决定是否显示名称、返回按钮、页签、搜索、状态、业务菜单或面包屑，优先组合原生 Button、Input、ActionMenu 等公开组件；框架不要求统一的导航数据模型。作者负责容器适配、本地化、键盘和错误反馈，不覆盖宿主公共控制。AI 模板的 [Header.tsx](templates/ai-checklist/src/client/Header.tsx) 展示独立渲染名称和进度。旧的 actvero.workbench.toolbar Factory 保留给已有包兼容使用，新项目可直接实现 Header。

正文和顶栏需要同步页面或选区时，在 apply 中调用作者的 `createNavigationStore()` 一次，并将同一个原生 Store handle 传给 store；两个组件通过 `PropsStore<ReturnType<typeof createNavigationStore>>` 获取 useStore 和 actions。状态按所需实例或视图标识组织，只保存导航、筛选等界面状态，业务数据仍由资源或作者的服务读取。不要传 Store 工厂来让两处各建一份状态，也不要把 Store handle 放入组件 props 或模块级变量；正文不通过 effect 向宿主反向写标题。

验收自定义顶栏时，确认宿主没有额外插入业务标识或导航；从正文和顶栏分别操作，检查内容与状态一致。至少检查 390px 窄窗口、明暗主题、菜单的 Escape 与焦点返回、切换工作台及停用释放。统一 AI 浮窗入口已存在，具体业务动作按需要组合，不重复通用 AI 按钮。选区使用[原生引用接口](#input-references)，按项目或文档区分对话使用[业务对象关联](#conversation-objects)。

<a id="settings-commands"></a>

### 原生设置页与关联对话命令

使用这组扩展时声明 `hostApi: "^1.3.0"`。Client 的注册选项增加 `settings: { component: Preferences, label: () => t('preferences') }` 和 `commands: [...]`。`Preferences` 接收 `WorkbenchSettingsProps` 以及注册选项指定的 `PropsLocale`、`PropsStore`；`close()` 关闭宿主设置，不改变当前对话。省略 label 时使用工作台名称。设置页跟随工作台安装启用，在原生设置导航中显示；无需先打开业务界面。停用或卸载时，面板、导航项和命令一起释放。

业务操作在 apply 层通过 `ctx.actveroWorkbenches.openSettings(manifest.name)` 打开自己的设置页，再将回调通过原生 Store action 等标准绑定传给组件；组件不持有 ctx。没有注册面板或原生设置外壳未加载时调用抛错，由操作入口显示本地化失败信息。设置组件只负责编辑与反馈：安装级偏好使用 Host Config 的 Volatile 字段及原生 ConfigForms 持久化；具体图纸、项目和业务对象的设置仍用作者的数据目录或服务。不要用前端 Store 或 localStorage 代替 Host 配置。配置读取、保存、冲突和重启恢复见源码仓库的[设置卡片指南](../docs/cookbook/adding-a-settings-card.zh.md)。

commands 中的每一项复用原生 `CommandContribution`，包含全局唯一的 `name`、本地化 `label()`、可选 `description()` 和图标、`available(session)` 与 `ui`。简单 UI 操作用 `{ kind: 'action', run(session) { ... } }`；选择菜单用 `{ kind: 'popupSelect', options(session, signal), onSelect(option, session), searchLabels() }`。框架额外限制为明确关联该工作台的对话；普通对话不会因最近使用过工作台而获得这些命令。名称冲突拒绝注册并回收此前贡献，不覆盖其他插件。命令本身不调用模型；有意发送请求必须走原生提交接口并获得相应用户授权。

菜单加载后切换工作台或数据实例，旧选项不能继续执行；停用会关闭菜单、取消未完成的选项加载并使已捕获回调失效。回调始终使用传入的 sessionId，不读取全局“当前对话”；作者负责固定业务对象和修订号、处理自身操作失败，并在异步 options 中响应 signal。已经开始的业务写入不因 UI 卸载而自动回滚，作者服务负责事务与取消。验收包含普通对话隔离、关联对话命令、菜单中途取消关联、设置页定位、窄窗口、深浅主题及停用后重新加载。

<a id="input-references"></a>

### 将业务选区放入原生输入框

需要引用图纸、清单或选中元素时，声明 `hostApi: "^1.2.0"`，在用户的“引用选区”操作中调用 `workbench.reference()`。它打开或复用关联的原生对话，插入可删除的引用标签，不发送消息。示例见 AI 模板的 [Checklist.tsx](templates/ai-checklist/src/client/Checklist.tsx)。

```ts
import type { WorkbenchClientContext, WorkbenchObjectId } from '@actvero/dsh-capability-ui/client/contracts'
async function referenceSelection(workbench: WorkbenchClientContext) {
  return workbench.reference({
    objectId: 'drawing-7' as WorkbenchObjectId,
    label: '流程图选区',
    revision: '4',
    content: '选中元素 A、B；矩形 A 指向 B。',
  })
}
```

`objectId` 在该业务实例内标识对象；`revision` 是作者管理的内容版本；`content` 是可读的固定快照，选中元素编号可包含在其中。调用时复制这些字段，等待期间切换选区不会改变本次引用。作者负责截取必要内容、控制长度并处理 Promise 拒绝；不要在 render 或 effect 中自动调用，也不要将模型凭据放入内容。

引用通过原生编辑器的选区和草稿版本检查插入，保留其他文字、附件和引用；正在提交时可能被拒绝，用户切换导航会取消插入。异步准备可能已创建空会话，但不会把引用转写到后来选择的对话。草稿刷新恢复、删除和发送重试由原生输入框管理；移除后不自动补回。

发送前，平台序列化器将 V1 `<workbench-reference>` JSON 快照写入原生用户消息，包含工作台、实例、对象和版本。复制为纯文本时也携带同一内容。历史引用可点击查看固定快照，业务包停用或卸载后仍可阅读；未知版本和损坏文本不伪装成有效引用，损坏的草稿标签会阻止发送并提示重新选择。引用不自动读取最新业务数据，也不授予写入权限；执行修改仍由专家和业务工具负责。打开当前对象需要下述 API 1.5 接口。

<a id="automatic-context"></a>

### 自动选区与发送

声明 `hostApi: "^1.5.0"` 后，作者可在业务选区变化事件中调用 `await workbench.selection(snapshot)`，字段与 `reference()` 相同；取消选区时传 `null`。它只更新已关联对话里的一个自动引用标签，不打开 AI、不创建会话、不发送消息、不改变对话关联对象。先由用户打开对应对话，再启用选区同步；不要在每次渲染中反复调用。需要用户主动添加、并保留多个历史选区时继续使用 `reference()`。

返回值 `attached` 表示已同步，`cleared` 表示已清除，`dismissed` 表示用户已删除或发送同一选区，`busy` 表示提交正在占用草稿，`inactive` 表示没有匹配对话或视图已失效。作者处理拒绝与异常，不能将 `inactive` 显示为成功。相同选区被删除或发送后不自动补回，选择新内容或先清空选区才重新附带。更新只替换自动标签，保留文字、附件和手动引用；旧视图、旧关联和过时异步回调不能改写新草稿。

标签可在输入框预览、移除并随草稿恢复。发送采用原生提交事务：模型和日志收到发送时的固定快照，之后选区变化不改写该消息；等待发送期间自动更新返回忙碌。发送失败沿用原生草稿恢复及错误提示，不覆盖用户已经输入的新草稿。框架不提供任意改写用户消息的发送钩子。

<a id="business-results"></a>

### 业务结果与历史对象

API 1.5 提供 `WorkbenchResult`、`workbenchResultText()` 和 `workbenchResultMetadata()`，从 `@actvero/dsh-capability-ui` 导入。结果包含 `schemaVersion: 1`、`title`、`summary`、`references`；每个引用携带与输入引用相同的固定快照，不能重复同一对象的同一版本。工具 execute 返回可序列化的业务结果，output.render 与 output.presentationMeta 分别用上述两个函数呈现同一份结果；不要在呈现时读取当前选区或重新查询可变数据。AI 模板的 `checklist_review` 展示完整接法。

原生工具日志保存结果元数据，平台渲染标题、摘要和对象标签。工具或业务包卸载后卡片和快照仍可阅读；未知或损坏版本保留原生工具输出。不要把业务 React 组件、回调或依赖仍在线的 URL 当成唯一历史记录。自定义任意消息布局仍使用原生插件接口，不属于此结果格式。

要让历史引用打开业务对象，Client 注册设置 `objectNavigation: true`，业务组件读取 `workbench.location` 并渲染对应对象；Host 实现 `resolveObject` 验证存在性和当前访问权限。平台先验证工作台、实例和对象，再打开业务页；不会创建新数据、切换专家或改写原对话的固定关联。`location.revision` 标记历史快照版本，打开的是当前对象，作者按需展示版本差异，不能将旧快照覆盖到现有数据。缺包、对象删除、无权限或导航被取消时，快照仍可阅读，并显示打开失败。

验收至少覆盖：选区连续变化、删除后不补回、发送中变化、发送失败、切换对话、草稿恢复、结果刷新重放、历史跳转、对象删除和停用后的阅读。使用 AI 清单模板完成非画布验收：创建并打包安装 → 添加任务 → 讨论该任务 → 选为上下文 → 调用 checklist_review → 从结果打开任务；普通对话不自动继承此工作台。

<a id="storage"></a>

## 运行目录与自定义存储

需要本机业务存储时，在 Host 入口注册工作台，获取稳定目录。下面的入口不启用 AI，也不需要实现 JSON 初始化或动作接口；客户端仍按相同标识注册业务组件。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
export const inject = ['actveroWorkbenchRuntime']
export async function apply(ctx: Context) {
  const runtime = ctx.actveroWorkbenchRuntime
  const id = '@local/my-workbench' as WorkbenchId
  ctx.effect(() => runtime.register({
    id, name: 'My workbench', version: '1.0.0',
    resourcesDirectory: import.meta.dirname,
  }))
  const instance = await runtime.open(id)
  const environment = await runtime.environment(instance)
  // Use environment.dataDirectory in your own Host service.
}
```

`dataDirectory` 是可写业务根目录，路径位于 `<DSH home>/actvero-workbench-data/<instanceId>`；升级和重新安装保持实例标识和路径。作者可以在其中建立多个业务项目，选择文件、JSON、SQLite 或远程存储，自行处理并发写入、事务、备份与格式迁移。Host 不保存第二份业务内容；新建自定义存储实例的 `json` 为 `"null"` 元信息占位；从旧 JSON 适配器切换时保留原内容，供作者迁移。原生会话日志和工作目录另行存储。

`resourcesDirectory` 指向包内资源，作者应传入绝对路径；未声明时返回 `null`，Host 不写入此目录。获取路径不授予 AI 或渲染器文件访问权限。业务前端可以调用 `await workbench.environment()` 查询环境，UI-only 工作台返回 `null`；实际文件读写通过作者的 Host 服务、MCP 或 CLI 完成。目录无法创建时明确报错，不退回临时目录或覆盖已有文件。

需要宿主托管 JSON 时，注册 `storage: { initial, reduce, actionHelp }` 适配器；旧式顶层字段继续兼容。只有该适配器支持通用 `action()` 和会话中的 JSON 读写工具；自定义存储调用通用动作会返回 `workbench/unsupported-storage`。卸载保留目录与实例记录，清理业务数据需要单独处理。

<a id="native-ai"></a>

## 接入原生 AI 与共享数据

基础模板仅注册业务界面。需要原生对话时，在 Host 入口注入 `actveroWorkbenchRuntime`，以 `ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))` 注册与客户端相同的工作台标识。自定义存储提供者通过 `ai: true` 开启原生对话，可携带名称、版本与指令组成的本地专家；未设置时不显示 AI 入口，也不自动创建会话。采用 `storage` 适配器时才声明初始 JSON、业务操作函数和给模型的操作说明。旧式顶层 `initial/reduce/actionHelp` 注册继续可用，并保持默认启用 AI。专家使用会话所选模型，无需另配模型。可选准备函数失败会阻止绑定或后续模型请求；它不能把未记录的上下文偷偷加入模型请求。

只使用原生 AI 的 Host 注册可以如下，不要求提供 JSON 存储适配器或专家文件。业务组件通过收到的 `workbench.conversation()` 打开或恢复原生对话；调用不会自动发送业务任务。Client 必须按同一个包名注册组件。可选的首次布局建议在 Client 的描述中设置 `display`，不是 `workbench.json` 的字段；它只影响首次使用，用户已保存的显示选择优先。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import manifest from '../package.json'
import metadata from '../workbench.json'
export const inject = ['actveroWorkbenchRuntime']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.actveroWorkbenchRuntime.register({
    id: manifest.name as WorkbenchId, name: metadata.name, version: manifest.version, protocol: metadata.protocol, ai: true,
  }))
}
```

组件收到 `workbench` 上下文，包含业务实例、关联会话、运行目录查询、AI 是否启用、原生资源地址、打开对话、执行业务操作和读取公开账户信息的方法。`account()` 未登录时返回空，已登录时只返回用户及组织标识和名称；这些公开字段不是凭据。`models()` 通过下述受控通道读取平台模型元信息。`conversation()` 按需创建或恢复当前关联对话，`action()` 携带最新修订号保存。注册组件时可向 `register(descriptor, component, { locale: namespace })` 传入已注册的本包语言命名空间，由宿主注入类型化 `t` 并响应语言切换。组件通过原生 `useResource` 读取数据，按自身容器宽度适配业务界面。悬浮预览使用 960 × 640 的业务视口等比缩小，禁用内部交互和滚动；编辑时进入工作台。

Host 为每个工作台保留一个稳定的默认运行实例。JSON 适配器让多条关联对话共享其 JSON；自定义存储中的项目划分由作者决定，可按下述接口为对话关联具体业务对象。普通「新会话」不自动继承工作台；工作台内部「新建工作台对话」关联同一实例。恢复已有对话时读取日志中的关联和专家版本；收起浮窗不取消关联，取消使用不删除清单。新建关联对话在文件根目录的 `.sessions/<instanceId>` 创建或复用以工作台命名的工作区，与业务数据目录分开，不要求用户选择文件夹。现有对话的目录保持原样。

可运行参考为[内置清单提供者](../packages/actvero/capability-ui/src/checklist.ts)及其[客户端](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx)。验收时分别检查首次默认展开 AI、对话默认预览、两种浮窗独立收起及刷新恢复、标题菜单切换关联对话与各自草稿、同一清单的手动与工具修改、并发冲突、重新打开会话、取消关联和窄窗口。安装和界面验收不替代真实模型及组织服务验证。

<a id="conversation-objects"></a>

### 为对话关联业务对象

需要让项目、文档或记录各自拥有对话时，在 workbench.json 声明 `protocol.hostApi: "^1.4.0"`，并保持 Host 与 Client 共用此声明。Host 提供者实现 `resolveObject(objectId, environment, signal)`：使用自己的存储确认对象存在且可访问，返回 `{ label }`；对象不存在、无权限或依赖不可用时拒绝。标识在同一实例中稳定且不可复用给其他对象，不能用可变名称或临时界面选中项作为标识。宿主不创建项目表、不复制对象内容，也不规定存储格式。

组件调用 `workbench.conversation({ objectId })` 优先复用该对象的关联对话，没有匹配项时新建；`fresh: true` 为该对象另建对话。`objectId: null` 显式选择整个运行实例；省略参数时保留现有关联。切换对象不会重绑另一对象已有的对话。工作台内的新建对话沿用当前关联对象；普通新会话仍不继承工作台。`workbench.object` 返回当前关联对话记录的标识和名称，组件可据此恢复业务视图；它不是全局选中状态。

宿主在绑定及每次模型步骤前调用 `resolveObject`，向 `prepare` 和 `activate` 传入只读的 `environment.object`，无对象关联时为 `null`。自定义工具应捕获此对象标识；MCP、CLI 或文件操作由专家明确传递目标，不读取另一个窗口的当前选择。对象名称在绑定时写入日志，之后改名不会偷偷改写历史。预检失败停止模型请求并释放该会话能力，保留关联和业务数据；恢复对象或显式选择可用对象后再继续。预检不是事务锁：实际读写时仍由作者检查对象存在、权限、修订号和冲突。可选 JSON 适配器的通用工具仍作用于整个实例，不自动变成对象级 CRUD。

验收至少覆盖两个对象各自的对话与草稿、同一对象多条对话、切换画面后原对话工具仍使用原目标、重启及分支恢复、对象删除后请求停止，以及旧命令菜单在关联变更后失效。对象关联写入 `actvero/workbench` 的 schemaVersion 2；实例级关联及解绑仍写版本 1。当前读取器兼容两种记录，旧版读取器拒绝版本 2；不要通过删除关联事件解决旧客户端兼容问题。

<a id="expert-bundle"></a>

## 随包专家、Skill、MCP 与 CLI

本节面向需要为工作台配置 AI 行为的作者。宿主提供原生对话、模型选择、日志和会话作用域；作者决定业务工具、文件格式与操作方式。工作台可只设置 `ai: true` 使用普通 AI，也可设置 `expert` 提供简单指令。需要完整依赖时使用 `@actvero/dsh-experts/workbench` 导出的 `WorkbenchExpertBundle`，无需创建或召唤普通专家记录。

将原始资源放在源码根目录的 `assets/`。`pack` 保留该目录并沿用安装包大小与路径校验；`src/` 中的原始文件不会自动复制。下面的 Host 入口适用于编译输出位于 `lib/index.js` 的包，客户端继续按相同标识注册业务组件。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import { WorkbenchExpertBundle } from '@actvero/dsh-experts/workbench'
import { fileURLToPath } from 'node:url'
import manifest from '../package.json'
import metadata from '../workbench.json'
const resources = fileURLToPath(new URL('../assets/', import.meta.url))
export const inject = ['actveroWorkbenchRuntime']
export function apply(ctx: Context): void {
  const bundle = new WorkbenchExpertBundle({ directory: resources })
  ctx.effect(() => ctx.actveroWorkbenchRuntime.register({
    id: manifest.name as WorkbenchId, name: metadata.name, version: manifest.version, protocol: metadata.protocol,
    resourcesDirectory: resources, ai: true, activate: bundle.activate,
  }))
}
```

`assets/expert.json` 使用 [ExpertManifest](../packages/actvero/experts/src/contracts.ts) 字段，工作台直接携带原始资源，不需要先制作或导入单专家 ZIP。以下为带一项必需 Skill 的完整最小示例；版本为三段数字。`key` 对应 `assets/dependencies.json` 的绑定，二者不能各自随意改名。Skill 的 `load: "always"` 将正文加入已记录的专家指令，`on_demand` 仅注册原生技能目录，交给原生技能工具按需读取；原生技能调用策略继续生效。

```json
{
  "schemaVersion": 1,
  "id": "delivery-assistant",
  "name": "交付助手",
  "version": "1.0.0",
  "description": "协助整理当前工作台的交付内容。",
  "instructions": "先读取当前数据，按用户要求修改；工具成功后再汇报结果。",
  "skills": [{ "key": "delivery", "label": "交付操作", "required": true, "load": "always" }],
  "connectors": []
}
```

与上例配对的 `dependencies.json` 如下，并提供 `skills/delivery/SKILL.md`。这是工作台加载器的依赖格式，不能照搬专家 ZIP 的平台依赖引用。

```json
{
  "schemaVersion": 1,
  "skills": [{ "key": "delivery", "source": "local", "path": "skills/delivery" }]
}
```

需要 MCP 时，在专家清单的 `connectors` 增加 `{ "key": "files", "label": "业务文件", "required": true }`，同时在依赖文件的 `connectors` 增加 `{ "key": "files", "source": "local", "path": "mcp.json" }` 并实现对应文件；未声明的绑定会被拒绝。需要 CLI 时，在依赖文件的 `cli` 增加 `{ "name": "delivery", "path": "cli.mjs", "runtime": "node", "description": "Manage delivery files; see the skill for arguments." }`，携带脚本并在 Skill 中说明参数和数据位置。不使用的能力不添加空壳依赖。

所有文件路径相对专家目录，不能越界、引用符号链接或使用绝对路径。`skills/delivery/SKILL.md` 按原生 Skill 规则解析。绑定必须对应清单中的声明；必需依赖缺失会阻止 AI 启用。可选声明没有绑定或已安装技能不存在时，专家指令会记录缺失状态；已绑定文件损坏或固定版本变化仍会报错。CLI 文件需要声明 `node`、`python` 或 `executable`；解释器按需从宿主已配置的原生运行环境解析。也可由 Host 作者通过 `runtimes` 提供明确的绝对解释器路径。

MCP 绑定文件采用原生 `dsh-mcp-client` 配置，例如 `{ "transport": "stdio", "command": "${node}", "args": ["${bundle}/server.mjs"], "cwd": "${data}" }`。命令、参数、工作目录、环境变量和 HTTP 地址/请求头中的 `${bundle}`、`${data}`、`${node}`、`${python}` 分别替换为资源目录、业务目录与原生解释器。参数按 argv 传递，不经过 shell 展开；MCP 的重连和超时沿用原生配置。网络认证由作者或服务提供，不将长期凭据写入分发包。CLI 声明只向专家说明命令，不会自动执行或安装依赖；专家通过原生 shell 工具调用它。

引用已安装 Skill 时使用 `{ "key": "delivery", "source": "installed", "name": "delivery", "sha256": "固定摘要" }`。没有本地资源目录的技能使用正文 UTF-8 SHA-256；带目录的技能使用 `SHA256(JSON.stringify([正文, 目录摘要]))`，目录摘要按相对路径排序，将每个文件的 `[相对路径, 文件 SHA-256]` JSON 依次输入 SHA-256。恢复和每次执行前都检查原生目录中的当前权限与摘要，撤销或变化时停止，不能靠旧缓存继续使用。平台依赖引用和自动下载安装尚未接入。

安装包本身是本地版本缓存。`WorkbenchExpertBundle` 在提供者生命周期内按工作台版本复用已解析资源，不联网查询，也不重复解析相同版本；不要在同一版本下直接修改已安装资源。每条对话独立注册 Skill 和 MCP，连接不跨对话共享。会话记录专家指令与依赖摘要；恢复后摘要不符会要求重新选择工作台，既有会话记录不会静默改写。作者升级时应提高包和提供者版本，业务文件保留。

使用 `activate(ctx, environment, signal)` 也可直接注册业务工具，或在 `await bundle.activate(...)` 后追加原生能力并返回结果。所有注册、监听和子插件必须归属传入的 `ctx`，响应 `signal`，不得使用外部全局注册表。绑定失败时，宿主释放此次新增的全部能力并保留之前的关联记录；再次执行会重新准备原关联。取消关联、会话结束或提供者卸载时，宿主等待能力释放和加载回调结束。Host 的 `open()` 和 `environment()` 不启动依赖，关闭 AI 浮窗也不取消已有关联。

验收时用手动操作、显式业务工具、Skill/CLI 和 MCP 修改同一份业务文件，并从业务界面重新读取；检查不同会话的能力隔离、重复打开、依赖缺失、启动失败、加载取消、卸载和重启恢复。工作台版本一致时应可离线复用；模型和远程 MCP 的实际请求仍可能需要网络。

<a id="display"></a>

## 显示控制与 Agent 入口

工作台作者在客户端注册元信息中设置可选的 `display: { sidebar: 'focus', ai: 'hide' }`，作为第一次打开的布局建议。`focus` 收起左侧导航，不进入操作系统全屏；未指定时保留导航。`ai: 'hide'` 保留 AI 入口但不主动创建对话；未指定时，启用 AI 的工作台恢复关联对话。用户通过宿主左上角的侧栏开关切换导航，通过浮窗右上角收起窗口；显示开关分别记忆，后续打开优先使用已保存的选择。离开业务主界面时恢复进入前的导航展开状态，宽度和窄窗口行为沿用宿主规则。

业务组件也可主动控制显示。以下调用通过宿主等待客户端实际挂载；不会发送消息，也不执行专家工具。

```js
await workbench.display({ mode: 'business', sidebar: 'focus', ai: 'hide' })
await workbench.display({ mode: 'business', ai: 'show' })
await workbench.display({ mode: 'preview' })
const visible = workbench.displayState()
```

`business` 让业务占据主内容区，`ai` 选择显示或收起 AI 浮窗；`conversation` 显示原生对话并收起业务预览；`preview` 在原生对话上悬浮业务预览。后两种需要工作台启用 AI，优先复用当前关联对话，否则创建一个原生关联对话。已有对话必须属于同一运行实例；重复进入复用实例和已关联会话。业务预览与 AI 浮窗各自记住开关和位置；拖动或键盘移动不会改变业务数据。预览是不可编辑的等比画面，需要操作时进入业务主界面。

常驻工具 `workbench_list` 列出已加载的 Host 提供者；`workbench_open` 选择显示方式，`workbench_status` 查询客户端当前状态。它们不要求当前线程已选择工作台。Agent 打开业务界面默认收起 AI，不自动把正在运行的调用线程重新绑定；显式选择对话或预览时，已有同工作台关联可继续使用，否则创建另一条关联对话。业务工具仍由随包专家决定，显示工具不会授予额外业务权限。

只有结果 `status: 'confirmed'` 表示客户端确认宿主视图已挂载，不代表作者的远程业务请求全部完成。没有客户端返回 `unavailable`，多个客户端返回 `ambiguous`，业务页无法加载返回 `failed`；断线或超过 `displayTimeoutMs` 返回 `unknown`，应先查询状态再决定下一步。默认等待 30 秒，可在能力包 Host 配置中调整。取消返回 `cancelled`，已经创建的实例或会话不会因此删除；连接恢复不重放导航。`workbench.display()` 在未确认时拒绝，调用方应显示可恢复的失败提示。UI-only 卡片可显示，但不会出现在 Host 提供者目录中，也不能创建原生对话。

<a id="platform"></a>

## 身份与平台模型目录

需要读取平台模型时，Host 提供者显式声明 `platform: ['models:read']`，业务组件按需调用 `await workbench.models()`。结果包含当前账户代际标识 `scope` 与 `models`；每个模型提供 `id`、`name`、`description` 和 `operations`，操作包含 `kind`、`inputModalities` 与 `outputModalities`。图片和视频操作不会被筛成只剩对话模型。没有声明能力、没有已加载的 Host 提供者、未登录或组织不可用时请求失败；本地清单仍可使用。

请求经 Host 转交 Electron Main，由 Main 使用当前账号的只读模型目录授权访问固定服务。返回值不含资源令牌、平台服务地址或自定义请求头；工作台不能借此向任意 URL 发起带宿主凭据的请求。它只读取目录，不提供图片、视频生成、额度或文件上传的通用代理。第三方服务仍由作者自行接入。

`scope` 仅用于区分账户与组织的请求代际，不是访问凭据。退出登录、替换平台或切换组织时作废旧请求；不缓存目录，后续调用重新读取当前授权。作者若缓存元信息，应在账户变化时清除，并按新 `scope` 更新，不把工作台业务目录视为自动按账号隔离。请求取消、超时、无权限、响应损坏和目录超限分别拒绝，不返回半份目录。Host 等待时限由 `platformTimeoutMs` 配置，默认 30 秒；远程访问只允许桌面所有者。

AI 模板的「查看可用模型」展示最小接入方式。平台未登录时显示可恢复提示，不要求给专家独立配置模型，也不会把账户信息或模型目录自动发进对话。真实平台权限和付费生成需另行验证。

<a id="verify"></a>

## 本地自测与故障定位

下表用于开发者和执行开发的 Agent 记录可观察结果；仅选择工作台实际使用的能力。每项记录「通过／失败／待验证／不适用」及命令输出、界面截图或实际业务结果。没有模型授权时可以完成本地业务、包和依赖检查，真实模型或外部写入保留待验证，不为验收自动提交收费生成。

| 检查 | 通过依据 |
|---|---|
| 包与代码 | 业务相关测试和项目类型检查分别有结果；`pack` 与 `check` 输出实际包路径、版本、大小和摘要；必需资源包含在产物中 |
| 安装清单 | 在指定客户端/Profile 中核对精确包名、版本和状态；记录 `application`，待重启不能记作已加载 |
| 左侧入口 | 「工作台 → 我的工作台」存在条目，加载成功后进入左侧切换菜单；名称相同不足以确定是当前包 |
| 真实界面 | 从切换菜单进入业务组件，图标、文案、预览、首次无会话入口正常；不是只看到管理卡片 |
| 业务与存储 | 完成一条真实最小流程，重开和刷新后数据仍在；使用实际的数据目录或远程数据源，不仅检查演示数据 |
| 原生 AI | 按需打开或恢复关联对话；验证实际采用的指令、Skill、工具、MCP 或 CLI 能读写同一份业务数据；其他无关联对话不获得这些能力 |
| 显示与布局 | 检查主界面、对话与只读预览的适用模式，收起和刷新记忆、侧栏展开/收起、明暗主题及窄容器；真实长度中英文无裁切、单字竖排或整页横向溢出 |
| 更新与恢复 | 新版本保留数据，已有对话能恢复或明确提示重新选择；依赖加载失败保留原关联并给出可恢复错误 |

`workbench_list` 只列已加载的 Host 提供者，UI-only 工作台应以管理页和真实界面验证。`workbench_open` 的 `confirmed` 证明宿主视图挂载；作者的远程请求和业务数据仍需另验。`unknown` 先用 `workbench_status` 核对，不直接重放安装或业务操作。

| 现象 | 下一步 |
|---|---|
| 找不到命令或依赖 | 核对当前目录、源码根 `package.json`、Node/pnpm 和锁定依赖；不要在业务目录执行仓库命令或启动另一套宿主 |
| 包校验失败 | 按具体诊断检查清单、入口、资源大小和路径，从源码重建；不要直接修改 `.tgz` 或已安装文件 |
| `incompatible-version` | 对比目标运行时与 `engines.dsh`，判断适配还是需要兼容客户端；不能只改版本号或授予豁免来证明兼容 |
| 已安装但没有入口或白屏 | 先查安装结果、启用状态及 Host/Client 加载错误，再核对两端包名、注册、依赖注入和控制台错误；仅待重启时提示重启 |
| AI 无法开启或操作 | 先区分未启用 AI、依赖准备失败、模型不可用与工具未挂载；核对 `ai`、`activate`、资源绑定和解释器。自定义存储不自动获得 JSON 读写工具 |
| 手动操作与 AI 数据不同 | 核对业务实例、项目选择、实际数据目录或远程作用域及工具读写位置；不要通过复制另一份数据掩盖问题 |

故障修复回到业务源码，安装更新前提高版本。不要改写会话日志、同版本安装资源或清空业务目录解决加载问题。无法操作目标客户端时，交付已校验包、准确导入入口和未验证清单，不能报告已加载。

<a id="limits"></a>

## 限制

本工具是仓库内开发入口，不是已经发布的通用 SDK。只接入本地 `.tgz`，不支持 ZIP 导入、平台下载、发布或自动更新；受控平台通道目前仅支持模型目录读取。专家依赖通过 Host 的 `activate` 显式加载；文件放入目录不会自动启用。平台依赖的下载安装不在本地加载器中处理。

安装包适用于 Actvero 自有工作台注册接口。旧 DSH 工作台使用不同的注册服务，不能仅修改标识就宣称兼容。DSH 参考文档保留在[离线快照](third-party/dsh-desktop-workbenches/development-guide.zh.md)，版本为 2026-10-27；它不是当前在线规范，也不替代本文的 Actvero 包约定。

上游参考规范于 2026-11-08 实际在线获取，最终地址为 https://dshdesktop.com/workbench/docs/development.md ，HTTP 200，文档版本为 2026-10-27；本次未采用离线替代。本文对应 ACTVERO 本地运行框架，按当前源码接口编写，不宣称支持上游全部接口。
