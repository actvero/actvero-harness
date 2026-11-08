# 本地工作台开发

[English](workbench-development.md) | 中文

## 概述

本文面向已配置 Actvero 仓库开发环境的工作台开发者：从项目清单模板开始，修改业务界面，构建一个可导入桌面客户端的本地安装包。无需 GitHub 账号、仓库地址或发布服务。模板使用当前仓库的编译器；这里的命令在仓库根目录运行。

## 目录

- [创建和打包](#create)
- [导入和验收](#install)
- [包格式](#format)
- [修改业务](#business)
- [运行目录与自定义存储](#storage)
- [原生 AI 与共享数据](#native-ai)
- [随包专家、Skill、MCP 与 CLI](#expert-bundle)
- [显示控制与 Agent 入口](#display)
- [身份与平台模型目录](#platform)
- [限制](#limits)

<a id="create"></a>

## 创建和打包

也可在管理页点击「制作工作台」，复制说明并在新对话补充业务目标。原生 `develop-workbench` Skill 随客户端提供，引用构建时从本文生成的指南；它不会自动决定业务内容或发送任务。当前开发命令需要源码仓库和已安装依赖，客户端尚未附带独立编译器。

先按[客户端开发说明](workbenches.zh.md)准备仓库依赖。创建命令只接受尚不存在的目标目录，保护已有文件。第二个参数是稳定包名，同一个工作台后续版本保持包名不变。

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist
pnpm run actvero:workbench pack .artifacts/my-checklist .artifacts/workbenches
pnpm run actvero:workbench check .artifacts/workbenches/local-my-checklist-1.0.0.tgz
pnpm run actvero:workbench create .artifacts/my-ai-checklist @local/my-ai-checklist --template ai
```

`create` 默认复制普通清单；追加 `--template ai` 生成带原生数据、AI 和本地专家 Skill 的「AI 项目清单」。两套模板均不需要登录即可使用本地功能，AI 模板首次打开保留 AI 入口而不创建对话。`pack` 所需的依赖由源码开发环境提供。

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
| `exports["."]` / `exports["./client"]` | 本工具输出的 `./lib/index.js` 和 `./lib/client.js` |
| `exports["./locale/*.json"]` | 打包生成名称与介绍元数据，工作台未加载时仍可展示 |
| `workbench.json` | 源码中的名称、介绍、分类、作者和标签；编译时纳入客户端 |
| `src/client/assets/` | 源码预览图；通过图片导入编入客户端，不依赖远程图床 |
| `src/index.ts` | Host 插件入口；模板无 Host 业务服务 |
| `src/client/index.ts` | 使用 Cordis effect 注册卡片与业务组件，卸载时注销 |

构建产物包含清单、生成的 patch、展示用 `locale`、编译后的 `lib` 以及可选的 `assets` 原始资源。`repository` 可以省略。React 使用宿主共享实例，CSS Modules 与图片使用仓库现有客户端编译器；不要把另一套 React 或宿主插件代码打入业务包。包校验是格式检查，不是代码沙箱。

<a id="business"></a>

## 修改业务

在 `workbench.json` 修改卡片文案；分类使用专家生态的统一标识：`office`、`engineering`、`design`、`content`、`data`、`education`、`lifestyle`、`general`、`uncategorized`。「我的工作台」不展示分类筛选，但包仍可携带分类。

在 `src/client/Checklist.tsx` 和相邻 CSS Module 修改业务视图，在 `locales.ts` 维护中英文案。在客户端入口声明预览图和可选 `iconUrl`；缺少图标时宿主显示默认图标。工作台注册接口见[客户端约定](../packages/actvero/capability-ui/src/contracts.ts)。业务内容占据主内容区，宿主保留公共导航与窗口控件。

示例按包名隔离浏览器本地存储，刷新后恢复清单；读取失败会显示错误并禁用修改，避免覆盖无法读取的数据。这里的存储属于当前客户端配置，不提供多项目、账户或组织隔离，也不提供备份。正式业务的数据管理需要独立设计。

<a id="storage"></a>

## 运行目录与自定义存储

需要本机业务存储时，在 Host 入口注册工作台，获取稳定目录。下面的入口不启用 AI，也不需要实现 JSON 初始化或动作接口；客户端仍按相同标识注册业务组件。

```js
export const inject = ['actveroWorkbenchRuntime']
export async function apply(ctx) {
  const runtime = ctx.actveroWorkbenchRuntime
  const id = '@local/my-workbench'
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

组件收到 `workbench` 上下文，包含业务实例、关联会话、运行目录查询、AI 是否启用、原生资源地址、打开对话、执行业务操作和读取公开账户信息的方法。`account()` 未登录时返回空，已登录时只返回用户及组织标识和名称；这些公开字段不是凭据。`models()` 通过下述受控通道读取平台模型元信息。`conversation()` 按需创建或恢复当前关联对话，`action()` 携带最新修订号保存。注册组件时可向 `register(descriptor, component, { locale: namespace })` 传入已注册的本包语言命名空间，由宿主注入类型化 `t` 并响应语言切换。组件通过原生 `useResource` 读取数据，按自身容器宽度适配业务界面。悬浮预览使用 960 × 640 的业务视口等比缩小，禁用内部交互和滚动；编辑时进入工作台。

Host 为每个工作台保留一个稳定的默认运行实例。JSON 适配器让多条关联对话共享其 JSON；自定义存储中的项目划分和对话对应关系由作者决定。普通「新会话」不自动继承工作台；工作台内部「新建工作台对话」关联同一实例。恢复已有对话时读取日志中的关联和专家版本；收起浮窗不取消关联，取消使用不删除清单。新建关联对话在文件根目录的 `.sessions/<instanceId>` 创建或复用以工作台命名的工作区，与业务数据目录分开，不要求用户选择文件夹。现有对话的目录保持原样。

可运行参考为[内置清单提供者](../packages/actvero/capability-ui/src/checklist.ts)及其[客户端](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx)。验收时分别检查首次默认展开 AI、对话默认预览、两种浮窗独立收起及刷新恢复、标题菜单切换关联对话与各自草稿、同一清单的手动与工具修改、并发冲突、重新打开会话、取消关联和窄窗口。安装和界面验收不替代真实模型及组织服务验证。

<a id="expert-bundle"></a>

## 随包专家、Skill、MCP 与 CLI

本节面向需要为工作台配置 AI 行为的作者。宿主提供原生对话、模型选择、日志和会话作用域；作者决定业务工具、文件格式与操作方式。工作台可只设置 `ai: true` 使用普通 AI，也可设置 `expert` 提供简单指令。需要完整依赖时使用 `@actvero/dsh-experts/workbench` 导出的 `WorkbenchExpertBundle`，无需创建或召唤普通专家记录。

将原始资源放在源码根目录的 `assets/`。`pack` 保留该目录并沿用安装包大小与路径校验；`src/` 中的原始文件不会自动复制。下面的 Host 入口适用于编译输出位于 `lib/index.js` 的包，客户端继续按相同标识注册业务组件。

```js
import { WorkbenchExpertBundle } from '@actvero/dsh-experts/workbench'
import { fileURLToPath } from 'node:url'
const resources = fileURLToPath(new URL('../assets/', import.meta.url))
export const inject = ['actveroWorkbenchRuntime']
export function apply(ctx) {
  const bundle = new WorkbenchExpertBundle({ directory: resources })
  ctx.effect(() => ctx.actveroWorkbenchRuntime.register({
    id: '@local/my-workbench', name: 'My workbench', version: '1.0.0',
    resourcesDirectory: resources, ai: true, activate: bundle.activate,
  }))
}
```

`assets/expert.json` 使用现有[专家清单格式](expert-package.zh.md)，包含 `schemaVersion`、`id`、`name`、`description`、完整版本和 `instructions`，以及 Skill/MCP 的依赖声明。声明中的 `key` 对应 `assets/dependencies.json` 的绑定。Skill 的 `load: "always"` 将正文加入已记录的专家指令，`on_demand` 仅注册原生技能目录，交给原生技能工具按需读取；原生技能调用策略继续生效。

```json
{
  "schemaVersion": 1,
  "skills": [{ "key": "delivery", "source": "local", "path": "skills/delivery" }],
  "connectors": [{ "key": "files", "source": "local", "path": "mcp.json" }],
  "cli": [{ "name": "delivery", "path": "cli.mjs", "runtime": "node", "description": "Manage delivery files; see the skill for arguments." }]
}
```

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

<a id="limits"></a>

## 限制

本工具是仓库内开发入口，不是已经发布的通用 SDK。只接入本地 `.tgz`，不支持 ZIP 导入、平台下载、发布或自动更新；受控平台通道目前仅支持模型目录读取。专家依赖通过 Host 的 `activate` 显式加载；文件放入目录不会自动启用。平台依赖的下载安装不在本地加载器中处理。

安装包适用于 Actvero 自有工作台注册接口。旧 DSH 工作台使用不同的注册服务，不能仅修改标识就宣称兼容。DSH 参考文档保留在[离线快照](third-party/dsh-desktop-workbenches/development-guide.zh.md)，版本为 2026-10-27；它不是当前在线规范，也不替代本文的 Actvero 包约定。

上游参考规范于 2026-11-08 实际在线获取，最终地址为 https://dshdesktop.com/workbench/docs/development.md ，HTTP 200，文档版本为 2026-10-27；本次未采用离线替代。本文对应 ACTVERO 本地运行框架，按当前源码接口编写，不宣称支持上游全部接口。
