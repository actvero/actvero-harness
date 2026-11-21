# 工作台实施手册

[English](workbench-implementation.md) | 中文

面向能编写 TypeScript、首次接手 ACTVERO 工作台的开发者与 Agent。本教程从业务选择到可安装的持久化示例，再到调试与交接；接口细节以[开发指南](workbench-development.zh.md)为准。需要可用的 Node、匹配本机系统与架构的开发套件，以及用于最终验收的 ACTVERO 客户端；不需要 Harness 源码、账号或模型调用。

<a id="choose"></a>

## 1. 先选最小实现

先把已确认的需求写成一条可验收的流程，例如「打开客户清单 → 添加一位客户 → 重新进入仍能看到」。在 DESIGN.md 说明谁使用、数据保存在哪里、首次打开看到什么、哪些操作失败后允许重试；已有答案直接沿用。先完成这一条流程，再扩展页面与 AI。

| 业务需要 | 起点 | 数据与能力 |
|---|---|---|
| 展示或计算，不保存业务记录 | 默认 blank 模板，仅注册 Client | React 状态保存临时交互；无需 Host provider |
| 小型结构化记录，需要跨会话保留 | blank 加本教程的 storage 适配器 | Host 保存 JSON，Client 订阅资源并带 revision 提交动作；无需 AI |
| 大文件、数据库、复杂索引或外部系统 | 自定义 Host provider | 先读[存储](workbench-development.zh.md#storage)与[生命周期](workbench-development.zh.md#lifecycle)；作者负责数据格式、事务和备份 |
| 需要 AI 理解或操作业务 | 在已跑通的业务上添加原生 AI | 从[原生 AI](workbench-development.zh.md#native-ai)开始，需要固定业务对象或专家工具时再接入对应能力 |

`plain` 模板的 localStorage 清单用于界面演示，不作为持久业务存储方案。`ai` 模板展示更多能力，不要求新工作台照搬；独立套件的 `actvero/templates/` 内有这些示例。自动化测试与手工界面验收都应围绕实际业务，不为不存在的能力添加流程。

### 文件职责

| 文件 | 职责 |
|---|---|
| `package.json` | 稳定包名、版本、Client 依赖声明与开发命令 |
| `workbench.json` | 名称、描述、分类、Host API 兼容要求 |
| `src/index.ts` | Host：持久化、业务校验、文件/网络、能力注册 |
| `src/client/index.ts` | Client：界面、临时状态、原生资源订阅与用户动作 |
| `src/counter.ts` | 本例共享的数据校验，不导入 Node API |
| `assets/` | 随包资源，例如图标、预览或专家文件 |
| `DESIGN.md` | 已确认的业务流程与视觉决定 |
| `.agents/skills/` | 随项目提供的开发手册和接口快照 |
| `.actvero/` | 本机工具链绑定与开发诊断，不作为业务数据目录 |

Client 不导入 Host 入口或 Node 文件系统。Host 与 Client 都从 package.json、workbench.json 读取身份和版本，注册通过 ctx.effect 释放；不要分别硬编码两套标识。

<a id="counter"></a>

## 2. 跑通一个持久化操作

这是独立练习：从 0 开始，每次点击增加 1，关闭工作台后再打开仍保留数值。不调用模型、不访问网络。使用新目录；修改已有业务时只参考接入方式，不覆盖文件。将命令中的绝对路径替换为实际位置，保留引号。

```sh
node "/绝对路径/开发套件/scripts/actvero-workbench.client.mjs" create "/绝对路径/counter-demo" @local/counter-demo
cd "/绝对路径/counter-demo"
```

在生成的 package.json 中，向 `dsh.client.inject` 数组追加 `@deepseek-ai/dsh-client-ui-primitives`，保留原有项。这是 Client 运行时共享模块声明；不能仅在 TypeScript 中添加 import。保留生成的兼容性声明和开发脚本，在 workbench.json 中把名称改为「计数示例」。本例使用套件已提供的 Zod；无需安装额外依赖。

新建 `src/counter.ts`，Host 持久化读取与 Client 资源读取共用同一个校验器：

```ts
/** Shared persisted data; invalid stored documents are never reset silently. */
import { z } from 'zod'

/** Counter document accepted by both the Host and Client readers. */
export const counterDocument = z.object({
  count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()
```

替换 `src/index.ts`。reduce 只计算新 JSON，不执行文件、网络或其他副作用；宿主负责串行保存和版本冲突检查。数据不合法、动作未知或计数溢出时拒绝写入，不能退回默认空数据：

```ts
/** A persistent workbench without AI or external services. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchId } from '@actvero/dsh-capability-ui'
import { z } from 'zod'
import manifest from '../package.json'
import metadata from '../workbench.json'
import { counterDocument } from './counter.ts'

const input = z.object({ action: z.literal('increment'), args: z.object({}).strict() })
/** Required Host service. */
export const inject = ['actveroWorkbenchRuntime']

/** Register the provider for this plugin lifetime.
 * @param ctx Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.actveroWorkbenchRuntime.register({
    id: manifest.name as WorkbenchId,
    name: metadata.name, version: manifest.version, protocol: metadata.protocol,
    ai: false,
    storage: {
      initial: () => JSON.stringify({ count: 0 }),
      actionHelp: 'increment args={}. Read the current revision before writing.',
      reduce(json, action, args) {
        input.parse({ action, args: JSON.parse(args) })
        const current = counterDocument.parse(JSON.parse(json))
        return JSON.stringify(counterDocument.parse({ count: current.count + 1 }))
      },
    },
  }))
}
```

替换 `src/client/index.ts`。保留 locale 与 resources 的 `import type {}`：它们加载类型扩展，不能当作无用导入删除。从 useResource 读取已确认的数据；动作携带当前 revision，成功后等待原生资源更新，不另存一份业务真值。断线时保留可读内容并禁用写入；结果未知时不自动重放：

```ts
/** Render the Host document and send revision-checked actions. */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkbenchBodyProps } from '@actvero/dsh-capability-ui/client/contracts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement, useState } from 'react'
import manifest from '../../package.json'
import metadata from '../../workbench.json'
import { counterDocument } from '../counter.ts'

const zh = {
  count: '当前次数：', add: '增加一次', pending: '正在保存…', loading: '正在读取…',
  readFailed: '数据暂不可用，请检查连接；不要清空数据。',
  invalid: '数据格式不兼容，请保留数据并检查版本。',
  saveFailed: '未确认保存成功，请核对当前数值后再操作。',
}
const en: Record<keyof typeof zh, string> = {
  count: 'Current count: ', add: 'Increment', pending: 'Saving…', loading: 'Loading…',
  readFailed: 'Data unavailable. Check the connection; keep existing data.',
  invalid: 'Incompatible data. Keep the data and check the version.',
  saveFailed: 'Save not confirmed. Check the current count before another action.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'workbench.example.counter': keyof typeof zh }
}
/** Required Client services. */
export const inject = ['actveroWorkbenches', 'locale']

/** Register the localized view until the package unloads.
 * @param ctx Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(manifest.name, 'zh', zh))
  ctx.effect(() => ctx.locale.register(manifest.name, 'en', en))
  function Panel({ t, workbench, useResource }: PropsLocale<'workbench.example.counter'> & WorkbenchBodyProps) {
    const resource = useResource<'actvero-workbench'>(workbench.resourceAddress ?? '')
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)
    const value = resource.value
    let count: number | undefined
    let invalid = false
    if (value) {
      try { count = counterDocument.parse(JSON.parse(value.json)).count }
      catch (_invalidDocument) { invalid = true }
    }
    async function increment(): Promise<void> {
      if (!value || count === undefined || pending || resource.status !== 'live') return
      setPending(true)
      setFailed(false)
      try { await workbench.action(value.revision, 'increment', '{}') }
      catch (_actionFailure) { setFailed(true) }
      finally { setPending(false) }
    }
    return createElement('section', { style: { padding: 24, display: 'grid', gap: 12, justifyItems: 'start' } },
      count !== undefined && createElement('output', { 'aria-live': 'polite' }, t('count'), count),
      invalid && createElement('p', { role: 'alert' }, t('invalid')),
      resource.status !== 'live' && createElement('p', { role: 'status' },
        t(resource.status === 'failed' ? 'readFailed' : 'loading')),
      createElement(Button, {
        disabled: count === undefined || pending || resource.status !== 'live',
        onClick: () => { void increment() },
      }, t(pending ? 'pending' : 'add')),
      failed && createElement('p', { role: 'alert' }, t('saveFailed')))
  }
  ctx.effect(() => ctx.actveroWorkbenches.register({
    ...metadata, id: manifest.name, version: manifest.version,
  }, Panel, { locale: manifest.name as 'workbench.example.counter' }))
}
```

在 DESIGN.md 写入这条练习流程与「Host JSON、无 AI、原生按钮」的选择，执行 `npm run doctor`、`npm run typecheck`、`npm run build`、`npm run check`。发生类型错误时先查绑定和真实声明，不通过 any、复制宿主内部类型或调低兼容版本绕过。检查输出中的实际 .tgz 路径，再按[导入和验收](workbench-development.zh.md#install)安装。

验证初值为 0，点击一次变为 1；离开再进入保持 1，重启目标测试客户端后仍保持。此例保存到宿主工作台实例，不包含多个业务项目；需要多个项目时由作者设计项目标识与数据结构。新增模型、数据库或迁移之前，先保留这条已通过的最小流程。

<a id="lookup"></a>

## 3. 扩展时找到真实接口

先查 Skill 的能力索引与 `reference/api/`。组件从绑定套件的 `packages/client/ui-primitives/lib/types/index.d.ts` 查导出，再打开同目录的 Button.d.ts、Input.d.ts 或 SegmentedControl.d.ts 等声明；源码方式可看对应 src。确认实际 props、locale 及 dsh.client.inject 后再使用，不假定其他组件库的 API 可直接套用。视觉与响应式规则交给 workbench-frontend Skill。

业务依赖装在工作台项目中并保存锁文件，按[包格式](workbench-development.zh.md#format)声明；不要对独立套件运行 npm install，或把 Harness 源码复制进业务项目。Host 的凭据和文件操作不下放给 Client。需要联网、写外部系统或调用真实模型时，先沿用用户授权和当前宿主提供的能力。

<a id="debug"></a>

## 4. 从失败的层开始调试

一次只复现一个失败。记录包名与版本、目标客户端/Profile、触发步骤、期望与实际结果。先查看 `update --json` 的安装诊断，再用 `status` 查询目标 Harness 的安装版本和前端发布状态。

| 现象 | 先检查 | 下一步 |
|---|---|---|
| create 或 doctor 失败 | Node、套件平台/架构、路径与绑定 | 修正路径或按项目 README 重新 bind；不先改业务代码 |
| typecheck 或 build 失败 | 首条编译错误、依赖与真实声明 | 在业务源码修复，再构建；不修改生成的 lib |
| check 或导入拒绝 | 归档检查、engines.dsh、protocol.hostApi、依赖确认结果 | 匹配工具链与客户端；不改版本数字伪装兼容 |
| 安装后卡片旧或打不开 | 实际安装版本、启用状态、application 与待重启结果 | 先按[安装流程](workbench-development.zh.md#install)确认加载；未知结果先查询 |
| Host 在但界面空白 | Client 模块加载错误、dsh.client.inject、注册标识 | 桌面 F12 查看开发者工具 Console；检查 Client 注册，不能用 Host 列表代替界面证据 |
| 点击后没更新 | 资源状态、动作是否失败、最新 revision | 先看实际数据；冲突后重新读取，不盲目覆盖或自动重放 |
| AI 无工具或失败 | 会话绑定、activate、专家依赖与取消结果 | 查[原生 AI](workbench-development.zh.md#native-ai)；业务数据可用不代表 AI 已验收 |

开发者工具的 Console 用于 Client 错误；Host 安装/加载/动作错误查看宿主操作结果与日志，不期待所有错误都出现在浏览器里。只采集本次失败相关内容，删除凭据和无关用户数据。定位到业务问题后回源码修复；目标桌面缺少能力时明确记录所需客户端版本，不能通过更改安装缓存解决。

<a id="acceptance"></a>

## 5. 按实际能力交付与交接

| 验收对象 | 可接受证据 |
|---|---|
| 构建与归档 | typecheck/build/check 实际结果、包版本、绝对路径与 SHA-256 |
| 安装与视图 | 已确认的目标客户端/Profile、安装结果、实际打开后的界面；待重启单独标明 |
| 核心业务 | 至少一条从输入到结果的完整操作；截图只证明界面，不能证明保存 |
| 持久化与失败 | 离开/重开后保留；未知动作、非法输入拒绝写入；有并发入口时验证旧 revision 不覆盖新数据 |
| 界面 | 最窄支持容器、明暗主题、键盘操作、加载/空/失败状态；遵循 workbench-frontend |
| 可选能力 | 仅有 AI、迁移、清理或远程写入时执行对应验收；真实与模拟结果分开记录 |

README 保留业务用途、启动命令、数据归属/备份、已验证环境与未验证项；DESIGN.md 保留决定，不写聊天过程。把业务项目交给另一台机器时不携带本机 .actvero 绑定，接收方取得匹配套件后 bind；把说明发给另一 Agent 时，附可读取的项目位置或文档文件，同机绝对路径不能跨机器使用。

完成报告分开说明「已构建」「已安装」「已加载」「业务已验证」。无法操作目标桌面时，交付已检查的包与安装路径，写明运行验收待完成；不能把这些状态合并为一句“全部完成”。
