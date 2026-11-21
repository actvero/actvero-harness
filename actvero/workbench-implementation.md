# Workbench implementation tutorial

English | [中文](workbench-implementation.zh.md)

For developers and Agents familiar with TypeScript but new to ACTVERO workbenches. This tutorial covers implementation choices, an installable persistence example, debugging and handoff; the [development guide](workbench-development.md) owns API details. Have Node, a developer kit matching the machine's OS and architecture, and an ACTVERO client for final acceptance. Harness source, an account and model calls are not required.

<a id="choose"></a>

## 1. Choose the smallest implementation

Express the confirmed requirement as one observable flow, such as “open the customer list → add a customer → reopen and find the saved customer.” Record the user, storage owner, first screen and retry conditions in DESIGN.md; reuse existing decisions. Complete this flow before expanding pages or AI.

| Business need | Starting point | Data and capabilities |
|---|---|---|
| Display or calculation without saved records | Default blank template with Client registration only | React state holds temporary interaction; no Host provider |
| Small structured records retained across sessions | Blank template plus this tutorial's storage adapter | Host persists JSON; Client subscribes and submits revision-checked actions; no AI required |
| Large files, databases, complex indexes or external systems | Custom Host provider | Read [storage](workbench-development.md#storage) and [lifecycle](workbench-development.md#lifecycle); the author owns formats, transactions and backups |
| AI understanding or business operations | Add native AI to a working business flow | Start with [native AI](workbench-development.md#native-ai), adding fixed business objects or expert tools when required |

The plain template's localStorage checklist demonstrates UI, not durable business storage. The ai template demonstrates additional capabilities; a new workbench need not copy them. These examples live in the independent kit's `actvero/templates/` directory. Automated tests and manual UI acceptance cover actual business capabilities.

### File responsibilities

| File | Responsibility |
|---|---|
| `package.json` | Stable package ID, version, Client dependencies and commands |
| `workbench.json` | Name, description, category and Host API requirements |
| `src/index.ts` | Host: persistence, validation, files/network and registration |
| `src/client/index.ts` | Client: UI, temporary state, resource subscriptions and actions |
| `src/counter.ts` | Shared data validation in this example; no Node API imports |
| `assets/` | Packaged icons, previews or expert files |
| `DESIGN.md` | Confirmed business flow and visual decisions |
| `.agents/skills/` | Project-local manuals and API snapshots |
| `.actvero/` | Local toolchain binding and diagnostics, not business storage |

The Client does not import the Host entry or Node filesystem. Host and Client read identity and version from package.json and workbench.json, and release registrations through ctx.effect; do not hardcode separate identities.

<a id="counter"></a>

## 2. Complete one persistent operation

This isolated exercise starts at 0, increments on each click, and retains the value after reopening. It uses no model or network. Use a new directory; for existing work, adapt the integration instead of overwriting files. Replace the absolute paths below with real locations and retain the quotes.

```sh
node "/绝对路径/开发套件/scripts/actvero-workbench.client.mjs" create "/绝对路径/counter-demo" @local/counter-demo
cd "/绝对路径/counter-demo"
```

Append `@deepseek-ai/dsh-client-ui-primitives` to `dsh.client.inject` in the generated package.json, retaining existing entries. This declares a shared Client runtime module; a TypeScript import alone is insufficient. Keep generated compatibility declarations and scripts, and name the workbench “计数示例” in workbench.json. Zod is supplied by the kit; no additional dependency installation is needed.

Create `src/counter.ts`; Host persistence reads and Client resource reads use the same validator:

```ts
/** Shared persisted data; invalid stored documents are never reset silently. */
import { z } from 'zod'

/** Counter document accepted by both the Host and Client readers. */
export const counterDocument = z.object({
  count: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()
```

Replace `src/index.ts`. The reducer computes new JSON without file, network or other side effects; the host serializes saves and checks revision conflicts. Invalid data, unknown actions and overflow reject the write instead of falling back to empty data:

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

Replace `src/client/index.ts`. Keep the locale and resources `import type {}` lines: they load type augmentations, not unused imports. Read confirmed data through useResource; submit the current revision and wait for resource updates after success instead of keeping another authoritative copy. When disconnected, retain readable content and disable writes; never replay an unknown outcome automatically:

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

Record this exercise and the choices “Host JSON, no AI, native button” in DESIGN.md. Run `npm run doctor`, `npm run typecheck`, `npm run build` and `npm run check`. For type errors, inspect the binding and real declarations; do not bypass them with any, copied host internals or lowered compatibility versions. Use the actual .tgz path in the output and follow [installation and acceptance](workbench-development.md#install).

Verify an initial 0 and a value of 1 after one click; leave and reopen to confirm 1 persists, then restart the target test client and check again. This example stores one host workbench instance, not multiple business projects; project identities and data structures are author-owned. Preserve this working flow before adding models, databases or migrations.

<a id="lookup"></a>

## 3. Find real interfaces before extending

Start with the Skill capability index and `reference/api/`. Find component exports in the bound kit's `packages/client/ui-primitives/lib/types/index.d.ts`, then inspect declarations such as Button.d.ts, Input.d.ts or SegmentedControl.d.ts in that directory; a source checkout also exposes src. Confirm actual props, locale and dsh.client.inject rather than assuming another library's API. Use the workbench-frontend Skill for visual and responsive rules.

Install business dependencies in the workbench project, retain the lockfile, and declare them under the [package format](workbench-development.md#format). Do not run npm install on the independent kit or copy Harness source into the project. Keep credentials and file operations in the Host. Network access, external writes and real model calls follow user authorization and available host capabilities.

<a id="debug"></a>

## 4. Debug the failing layer

Reproduce one failure at a time. Record the package name and version, target client/Profile, steps, and expected and actual results. Read the `update --json` diagnostic, then use `status` to check the installed version and Client publication in the target Harness.

| Symptom | Check first | Next action |
|---|---|---|
| create or doctor fails | Node, kit OS/architecture, paths and binding | Correct the path or bind again using the project README; do not first change business code |
| typecheck or build fails | First compiler error, dependencies and real declarations | Fix source and rebuild; do not edit generated lib |
| check or import rejects the package | Archive checks, engines.dsh, protocol.hostApi and dependency approval | Match kit and client; do not change version numbers to disguise incompatibility |
| Old card or failure to open after installation | Actual installed version, enabled state, application and pending restart | Establish loading through the [installation flow](workbench-development.md#install); query unknown outcomes first |
| Host exists but the view is blank | Client module errors, dsh.client.inject and registration IDs | Use desktop F12 DevTools Console; check Client registration, not just the Host list |
| A click does not update the data | Resource state, action failure and latest revision | Inspect actual data first; reread on conflict without blind overwrite or automatic replay |
| AI has no tools or fails | Conversation binding, activate, expert dependencies and cancellation | Read [native AI](workbench-development.md#native-ai); working business data does not establish AI acceptance |

DevTools Console diagnoses Client errors; use host operation results and logs for Host installation, loading and action errors rather than expecting every failure in the browser. Collect relevant evidence only, removing credentials and unrelated user data. Fix business errors in source; if the desktop lacks a capability, record the required client version instead of modifying installation caches.

<a id="acceptance"></a>

## 5. Accept and hand off actual capabilities

| Acceptance subject | Evidence |
|---|---|
| Build and archive | Actual typecheck/build/check results, package version, absolute path and SHA-256 |
| Installation and view | Confirmed target client/Profile, installation result and an opened view; distinguish pending restart |
| Core business | At least one complete input-to-result operation; screenshots establish appearance, not persistence |
| Persistence and failures | Retention after reopening; rejection of unknown actions and invalid input; stale-revision rejection when concurrent entry points exist |
| UI | Narrowest supported container, both themes, keyboard operation and loading/empty/error states; follow workbench-frontend |
| Optional capabilities | Exercise AI, migration, cleanup or external writes only when present; distinguish real and simulated results |

Keep purpose, commands, data ownership/backup, verified environment and unverified items in README; keep decisions rather than chat history in DESIGN.md. When handing a project to another machine, omit the local .actvero binding and have the recipient bind a matching kit. When handing instructions to another Agent, include an accessible project location or documentation files; same-machine absolute paths do not work across machines.

Report “built,” “installed,” “loaded” and “business verified” separately. If the target desktop cannot be operated, deliver the checked archive and installation directions while marking runtime acceptance pending; do not collapse these states into “everything is complete.”
