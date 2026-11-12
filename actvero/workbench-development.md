# Workbench development

English | [中文](workbench-development.zh.md)

## Summary

This guide is for workbench developers and Agents taking over a project: create a local directory, implement the business and visual design, validate and package it, then install and verify it in the target client. No GitHub account, repository URL or publishing service is required. Initialization uses a built ACTVERO source toolchain; subsequent development commands run inside the generated project.

## Table of Contents

- [Development environment and task entry](#environment)
- [Create and package](#create)
- [Import and verify](#install)
- [Package format](#format)
- [Edit the business view](#business)
- [Runtime directories and custom storage](#storage)
- [Native AI and shared data](#native-ai)
- [Bundled experts, Skill, MCP and CLI](#expert-bundle)
- [Display control and Agent entry points](#display)
- [Identity and platform model directory](#platform)
- [Local verification and troubleshooting](#verify)
- [Limitations](#limits)

<a id="environment"></a>

## Development environment and task entry

When distributed with the native `develop-workbench` Skill, `reference/environment.json` records the same build's DSH baseline, workbench format, capability-package versions and reference sources. `reference/api/` contains read-only interface source copies for checking arguments, not an installable SDK. Links to material absent from the Skill identify its source-checkout path. Check the actual target client's version first; a source baseline or this snapshot does not establish another client's capabilities.

Locate the ACTVERO source root from the current project or a user-provided location. Verify `scripts/actvero-workbench.client.ts`, `actvero/upstream.lock.json`, `actvero/templates/` and the root `package.json` command `actvero:workbench`; the business output directory is not the toolchain root. Run the commands below there and compare versions with the root `package.json` fields `engines` and `packageManager`. Prepare missing dependencies according to repository instructions rather than creating a substitute host or Agent engine.

```sh
node --version
pnpm --version
```

Read existing sources directly for a defined modification; use `create` only for a new workbench. A name or directory without a business goal requires minimum-flow clarification first. Confirm source location and installation client separately: an isolated development Profile is not the everyday application. Sources may live outside the repository; relative output paths below are examples. Use confirmed paths and quote paths containing spaces. Ask for the toolchain location when missing rather than claiming an installed client alone can compile.

<a id="create"></a>

## Create and package

You can also choose “Create a workbench” in the manager, copy the instructions and describe your goal in a new conversation. The native `develop-workbench` skill ships with a guide generated from this document at build time; it neither chooses the business purpose nor sends a task automatically. The commands currently require a source checkout and installed dependencies; the desktop does not include a standalone compiler.

Prepare repository dependencies using the [client development guide](workbenches.md), then run `pnpm run build:artifacts` at the repository root to build the current interface declarations. Creation accepts only a destination that does not exist. The optional second argument is the stable package name; when omitted, creation derives and saves a local name from the initial path. Retain that name when moving the directory.

```sh
pnpm run actvero:workbench create .artifacts/my-workbench @local/my-workbench
cd .artifacts/my-workbench
npm run doctor
npm run typecheck
npm run build
npm run check
```

Explicitly select a checklist example from the repository root when needed:

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist --template plain
pnpm run actvero:workbench create .artifacts/my-ai-checklist @local/my-ai-checklist --template ai
```

`create` defaults to a compilable blank view without business behavior or AI. `plain` provides a browser-storage checklist; `ai` provides “AI 项目清单” with native data, AI and a local expert Skill. Local example features work without sign-in; examples do not establish user requirements.

The generated directory includes README.md, AGENTS.md, DESIGN.md, commands, type configuration and two Skills. Confirm the minimum business flow first, then record its entry point, storage, AI, pages and acceptance criteria in DESIGN.md. The separate workbench frontend Skill supports native, branded and custom styles, preferring shared components and themes. Record reasons for customization. Project instructions let another Agent locate the development resources.

`doctor` checks declarations, entries and the runtime baseline, reminding authors about unfinished design decisions. `typecheck` checks author code against declarations built by the current toolchain. `build` and `pack` both typecheck, compile Host and Client, generate the bundle patch and report a validated `dist/*.tgz`, byte count and SHA-256. Builds do not modify business sources, install or publish; failure retains the previous artifact. `check` uses the unique archive in dist; with multiple versions, run `npm run check -- /absolute/path/package.tgz`. Authors add tests appropriate to their business behavior.

Commands use the source checkout recorded in `.actvero/toolchain.json`; this is not a standalone SDK. That file and generated tsconfig.json stay uncommitted. After moving the project or changing machines, run `node scripts/workbench.mjs bind /absolute/path/actvero-harness` inside the project. Rebinding refreshes compiler settings, both Skills and interface references, preserving business code, README.md, AGENTS.md and DESIGN.md. Agents explicitly read .actvero/skills; automatic discovery by other Agent products is not assumed.

`check` reuses desktop import preflight and checks the format marker, version declarations, nonempty entry files, and duplicate, escaping, or linked paths. It does not execute workbench code or establish business acceptance. Installation also checks compatibility with the current runtime; the development command does not bypass this check.

Existing projects can use `pnpm run actvero:workbench doctor <directory>`, `typecheck <directory>`, `pack <directory> [output]` and `check <archive.tgz>` at the repository root. Projects without type configuration use the current baseline configuration. Updates retain the package name and data and increase `package.json.version`; Host and Client read it from that file. Install the reported absolute `path`. Structural, type and archive checks do not establish business behavior, expert dependency activation or successful installation.

<a id="install"></a>

## Import and verify

Start the target Actvero client, open Workbenches → My workbenches, choose Import workbench and select the output. If the result requires a restart, use Harness → Restart Harness. After loading, the catalog and sidebar switcher display the name from workbench.json; the default blank template displays 空白工作台.

An Agent first discovers the target's actual installation tools and reads their arguments. Use a dedicated local installer according to its declared interface when available. Native `plugin_manager` can inspect the current Profile through `list_bundles` and perform a first installation using `install_bundle` with the checked `.tgz` absolute path and native authorization. The generic tool does not accept the manager page's reviewed version-replacement arguments; updates use a replacement-capable dedicated tool or that page. Do not invent tools or bypass update checks through removal and reinstallation. Without tool or UI access, deliver the archive and mark installation pending.

For installation `application`, verify loading after `applied`; `restart-required` means saved but awaiting restart. `failed`, `cancelled` and `overridden` are not activation; query unknown outcomes again. An Agent inside the target application must not close, restart or probe processes to manage its restart. Ask the user to finish this turn before using the top Restart now notice or Harness → Restart Harness. The user may try it directly or return with “重启好了” for continued verification. An isolated development client outside the target follows its normal restart procedure within existing authorization.

Open the workbench and exercise its actual business flow. For persistent data, reopen it from the manager and after a client reload; a checklist example can verify a checked item. Check previews, expanded/collapsed sidebar, light/dark themes and a narrow window. The default blank template creates no conversation and requires no workspace selection. Verify the installation result, catalog entry, switcher and actual business view separately.

To update, retain the package name, increase `package.json.version`, and rebuild. Select the archive through the card's More → Update version action or import it directly; confirmation shows the installed and incoming versions. Repeated versions, downgrades, mismatched names, and incompatible runtimes are refused. A replacement requiring restart shows Restart required; after restarting Harness, check the card’s Open action, version and business content. Independently stored data is retained; business schema migrations belong to the workbench.

The card’s More menu offers disable, enable and uninstall, plus the host-managed data folder when the workbench is loaded and a native file manager is available. Disablement and removal require confirmation and retain local data directories and conversation history. Disabling retains the package in My workbenches across restarts; only loaded workbenches enter the sidebar switcher. Importing the same package after uninstall restores the example checklist. Installation changes inspect linked conversations first; running conversations or unavailable activity state block the operation. On installation or update failure, inspect diagnostics and verify the inventory. Successful installation does not establish business acceptance.

<a id="format"></a>

## Package format

The workbench extension API and DSH runtime versions are checked separately: the current extension API is `1.3.0`, with declaration format `schemaVersion: 1`. Templates put `protocol` in workbench.json; a new Host provider also passes `protocol: metadata.protocol`, while the Client reads the same metadata. A legacy package without a declaration resolves to the original API `^1.0.0`, rather than automatically accepting a future API. Invalid formats, unknown fields, unsupported declaration versions and incompatible API ranges are rejected before registration. Doctor, pack, check and Client import preflight check compatibility; actual Host and Client registrations still validate independently, so archive checks do not replace loading verification.

The format marker is `dsh.actveroWorkbench: 1`. Deliver an npm-compatible `.tgz` with contents under `package/`, at most 8 MiB compressed and 32 MiB unpacked. The npm package name provides stable identity; registration reads the display metadata from `workbench.json` and version from `package.json`.

| File or field | Purpose |
|---|---|
| `package.json.name` / `version` | Stable package name and complete SemVer version; the template registers under the package name |
| `package.json.type` | Must be `module`; Host and Client use ESM |
| `package.json.icon` | Optional package artwork, for example `./assets/icon.svg`; SVG, PNG, JPEG or WebP, at most 256 KiB |
| `engines.dsh` | Supported DSH runtime range; the template pins the current development baseline |
| `workbench.json.protocol` | `schemaVersion: 1` and the required API range; use `hostApi: "^1.1.0"` for header extensions; both Host and Client registrations read this declaration |
| `dsh.actveroWorkbenchProtocol` | Generated from that declaration during packaging; Client import preflight and check validate the same host API requirement |
| `dsh.bundle.patch` | Points to `./cordis.patch.yml`, adding the package to the current Profile |
| `dsh.client` | Declares the Web client and preceding dependencies including `@actvero/dsh-capability-ui` |
| `exports["."]` / `exports["./client"]` | This tool's `./lib/index.js` and `./lib/client.js` outputs |
| `exports["./locale/*.json"]` | Generated name and description metadata remains available before the workbench loads |
| `workbench.json` | Source display name, description, category, author, and tags, compiled into the Client |
| `src/client/assets/` | Source previews, bundled through image imports without remote image hosting |
| `src/index.ts` | Host plugin entry; the template has no Host business service |
| `src/client/index.ts` | Registers the card and component through a Cordis effect, removing them on disposal |

The artifact contains the manifest, generated patch, display `locale`, compiled `lib`, and optional raw `assets`. `repository` may be omitted. React uses the Host's shared instance; CSS Modules and images use the repository client compiler. Do not bundle a second React or Host plugin implementation into business code. Package validation checks format, not code confinement.

Edit new templates at the following locations. The packager generates `cordis.patch.yml`, `lib/` and display `locale/`; do not edit installed files.

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

## Edit the business view

Edit card copy in `workbench.json`. Categories use the expert ecosystem's identifiers: `office`, `engineering`, `design`, `content`, `data`, `education`, `lifestyle`, `general`, and `uncategorized`. My workbenches omits category filtering, but packages may carry a category.

Organize business components and CSS Modules under `src/client/` and keep bilingual copy in locale dictionaries; checklist examples use Checklist.tsx and locales.ts. Declare preview imports in the Client entry. Put artwork in the package-root `assets/` directory and declare it once in `package.json`, for example `"icon": "./assets/icon.svg"`. The Host reuses it in cards, details, the switcher, the business title, the conversation picker, the composer badge and the floating-workbench control. Missing or failed artwork uses the native fallback. A Client `iconUrl` remains supported when package artwork is absent. Management and AI-assistant entries retain Host icons. See the [Client definitions](../packages/actvero/capability-ui/src/contracts.ts) for registration. Business content occupies the main area while the Host retains public navigation and window controls.

The example isolates browser local storage by package name and restores progress after reload. A failed read reports an error and disables changes instead of overwriting unreadable data. This storage belongs to the current client configuration; it provides no project, account, or organization isolation and no backup. Production business data requires its own storage design.

<a id="header"></a>

### Custom header and shared view state

Extension API `1.1.0` supports registration options `{ locale: namespace, header: Header, store: navigationStore }`. Both header and store are optional. The host retains the workbench-list return control and divider by default, plus sidebar and window controls. Header renders the entire business header, without an injected icon, name, breadcrumbs, dropdown or actions. Without Header, the host shows a minimal workbench icon and name. Previews render only the body; the registration disposer removes the card, body and header together.

With `hostApi: "^1.6.0"`, Client registration may pass `catalogButton: 'hide'` to omit the public catalog return button and divider; omission or `'show'` retains them. The host still manages sidebar and window controls. Authors arrange navigation back to projects, canvases or other business pages; users can also reach workbench management through the global sidebar.

Header uses WorkbenchHeaderProps, receiving title as a reference, the same workbench as the body, and native resource hooks. It returns author-owned React content. Authors decide whether to include a name, back button, tabs, search, status, business menus or breadcrumbs, preferably using public native Button, Input and ActionMenu components. The framework requires no common navigation data model. Authors own container adaptation, localization, keyboard behavior and failure reports, while preserving public host controls. With the macOS sidebar collapsed, the host places window controls in a separate safe strip; business headers need no left offset for those controls. Adapt headers to their container width rather than positioning against the whole window. The AI template's [Header.tsx](templates/ai-checklist/src/client/Header.tsx) renders its own name and progress. The older actvero.workbench.toolbar Factory remains available for existing packages; new projects can implement Header directly.

When body and header share navigation or selection, call the author's createNavigationStore() once inside apply and pass that native Store handle as store. Both components derive useStore and actions from PropsStore<ReturnType<typeof createNavigationStore>>. Organize state by the required instance or view identifiers. The store carries navigation and filters; business data stays in resources or author-owned services. Do not pass a factory that creates separate stores or put a Store handle in component props or a module-level variable. Body effects must not push titles into the host.

Verify that the host injects no extra business identity or navigation into a custom header. Operate from both body and header and check matching content and state. Cover 390px windows, both themes, menu Escape and focus restoration, workbench switching and disable cleanup. The native AI launcher already exists; compose specific business actions as needed without duplicating the generic launcher. API 1.6 adds the Client registration option `conversationTarget` for opening its current business object: return a stable `WorkbenchObjectId`, return `null` for an instance-wide conversation, or omit the callback to resume the existing association. Capture the object ID before awaiting saves or other preparation. Rejection stops opening and reports failure; navigation or disposal discards pending results. Resolution happens when opening AI; view navigation never rewrites existing conversations, and New conversation inside the float keeps its current conversation object. The Host must still validate targets through `resolveObject`. Use [native input references](#input-references) for selections and [business-object bindings](#conversation-objects) to separate conversations by project or document.

<a id="settings-commands"></a>

### Native settings pages and associated-conversation commands

Declare `hostApi: "^1.3.0"` for these extensions. Client registration accepts `settings: { component: Preferences, label: () => t('preferences') }` and `commands: [...]`. `Preferences` receives `WorkbenchSettingsProps` plus the configured `PropsLocale` and `PropsStore`; `close()` dismisses native Settings without changing the conversation. Omitting label uses the workbench name. The page appears in native Settings while the workbench is enabled, even before its business view opens. Disabling or uninstalling releases the page, navigation item and commands together.

At apply time, business actions call `ctx.actveroWorkbenches.openSettings(manifest.name)` and expose that callback to components through a native Store action or another standard binding; components never retain ctx. The call throws if the page is unregistered or the native settings shell is unavailable; the action entry owns localized failure feedback. Settings components own editing and feedback only: persist installation-wide preferences through Host Config Volatile fields and native ConfigForms. Drawing, project and other business-object settings remain in author-owned storage or services. Do not substitute a frontend Store or localStorage for Host configuration. The source repository's [settings-card guide](../docs/cookbook/adding-a-settings-card.md) covers reads, saves, conflicts and restart recovery.

Each commands entry uses native `CommandContribution`: globally unique `name`, localized `label()`, optional `description()` and icon, `available(session)` and `ui`. Simple UI actions use `{ kind: 'action', run(session) { ... } }`; selectors use `{ kind: 'popupSelect', options(session, signal), onSelect(option, session), searchLabels() }`. The framework additionally limits them to conversations explicitly associated with this workbench. Ordinary conversations never inherit commands from the last-used workbench. Name collisions refuse registration and roll back prior contributions rather than replacing another plugin. Commands do not inherently call a model; intentional submission must use native submission APIs with appropriate user authorization.

Switching workbenches or data instances invalidates options loaded by an earlier menu. Disabling dismisses menus, cancels pending option loads and invalidates captured callbacks. Callbacks use the supplied sessionId, never a global current conversation. Authors capture business objects and revisions, report their operation failures, and honor signal in asynchronous options. UI disposal does not roll back business writes already started; the author service owns transactions and cancellation. Verify ordinary-conversation isolation, associated commands, detachment during selection, settings navigation, narrow layouts, both themes and reload after disabling.

<a id="input-references"></a>

### Insert business selections into the native composer

To reference a drawing, checklist or selected elements, declare `hostApi: "^1.2.0"` and call `workbench.reference()` from the user's reference-selection action. It opens or reuses the associated native conversation and inserts a removable reference chip without sending a message. See [Checklist.tsx](templates/ai-checklist/src/client/Checklist.tsx) in the AI template.

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

`objectId` identifies an object within the business instance; `revision` is the author-managed content version; `content` is a readable, fixed snapshot that may include selected element ids. These fields are copied when called, so later selection changes cannot alter the reference. Authors select necessary content, limit its length and handle Promise rejection. Do not call from render or effects, or put model credentials in content.

Insertion uses the native editor selection and draft-revision checks, preserving other text, attachments and references. A submitting composer can refuse insertion, and user navigation cancels it. Preparation may already have created an empty conversation, but never redirects the reference to a subsequently selected conversation. Native input manages draft restoration, removal and send retries; removing a chip never automatically adds it back.

Before sending, the platform serializer writes a V1 `<workbench-reference>` JSON snapshot into the native user message with workbench, instance, object and revision identities. Plain-text copy carries the same content. Historical references open their fixed snapshots even after the business package is disabled or uninstalled. Unknown versions and damaged text remain visible as plain text; damaged draft chips block sending and ask for reselection. References neither fetch current business data nor grant write access; experts and business tools still own mutations. Opening the current object requires the API 1.5 interfaces below.

<a id="automatic-context"></a>

### Automatic selection and submission

With `hostApi: "^1.5.0"`, authors may call `await workbench.selection(snapshot)` on business selection changes using the same fields as `reference()`; pass `null` when selection clears. It updates one automatic chip in an associated conversation without opening AI, creating a conversation, sending a message or changing its object binding. Have the user open the appropriate conversation before enabling selection synchronization; do not call on every render. Keep using `reference()` for explicit additions and multiple retained selections.

The result `attached` means synchronized, `cleared` means removed, `dismissed` means the user removed or sent this selection, `busy` means submission owns the draft, and `inactive` means no matching conversation or an expired view. Authors handle refusal and rejection; never report `inactive` as success. A removed or sent selection stays dismissed until its content changes or selection is cleared. Updates replace only the automatic chip, preserving text, attachments and manual references; outdated views, bindings and asynchronous callbacks cannot edit the new draft.

Users can preview and remove draft chips, which restore with the draft. Native submission captures a fixed snapshot for the model and log; later selection changes cannot change that message, and automatic updates are refused while submission is pending. Failure uses native draft restoration and notices without overwriting a newer user draft. The framework does not expose a hook for arbitrary rewriting of user messages.

<a id="business-results"></a>

### Business results and historical objects

API 1.5 exports `WorkbenchResult`, `workbenchResultText()` and `workbenchResultMetadata()` from `@actvero/dsh-capability-ui`. Results contain `schemaVersion: 1`, `title`, `summary` and `references`; each reference carries the same fixed snapshot as input references, with no duplicate object revision. A tool execute returns serializable business output; output.render and output.presentationMeta use the two helpers to present the same result. Presentation must not query mutable data or read the current selection. The AI template implements this in `checklist_review`.

Native tool logs persist result metadata, and the platform renders titles, summaries and object chips. Cards and snapshots remain readable after the tool or business package is removed; unknown or damaged versions retain native tool output. Do not make business React components, callbacks or a live URL the only historical record. Arbitrary custom message layouts still use native plugin interfaces and are outside this result format.

To open objects from historical references, register the Client with `objectNavigation: true` and render the object addressed by `workbench.location`; implement Host `resolveObject` to verify existence and current access. The platform validates workbench, instance and object before opening the business page, without creating data, switching experts or changing the original conversation binding. `location.revision` identifies the historical snapshot; navigation opens the current object. Authors may show revision differences but must not overwrite current data with the snapshot. Missing packages, deleted objects, denied access and cancelled navigation leave the saved snapshot readable with an opening failure notice.

Verify continuous selection changes, dismissal, changes during submission, send failure, conversation switching, draft restoration, result replay after refresh, historical navigation, deleted objects and reading after disabling. Exercise the non-canvas AI checklist: create and package/install → add a task → discuss that task → select it as context → call checklist_review → open the task from its result. Ordinary conversations must not inherit the workbench.

<a id="storage"></a>

## Runtime directories and custom storage

Register a Host provider to obtain a stable directory for local business storage. This entry does not enable AI or require JSON initialization and action methods; the Client still registers its business component under the same identifier.

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

`dataDirectory` is a writable business root at `<DSH home>/actvero-workbench-data/<instanceId>`; upgrades and reinstall preserve the instance identifier and path. Authors can organize multiple projects and choose files, JSON, SQLite or remote storage, owning concurrent writes, transactions, backups and format migrations. The Host does not maintain another copy of business content; new custom instances use `json: "null"` solely as a metadata placeholder; switching from a JSON adapter retains its content for author-managed migration. Native session logs and working directories are stored separately.

`resourcesDirectory` identifies package resources and must be absolute when declared; omission returns `null`, and the Host never writes there. Obtaining a path grants no AI or renderer filesystem permissions. Business components can query `await workbench.environment()`; UI-only workbenches return `null`. Actual file operations belong to author-provided Host services, MCP or CLI integrations. Directory creation failures are reported without falling back to temporary directories or overwriting existing files.

For host-managed JSON, register a `storage: { initial, reduce, actionHelp }` adapter; legacy top-level fields remain supported. Only this adapter supports generic `action()` and conversation JSON tools; generic actions against custom storage return `workbench/unsupported-storage`. Uninstall retains directories and instance records; business-data deletion is a separate operation.

<a id="native-ai"></a>

## Native AI and shared data

The basic template registers a business UI only. To support native conversations, inject `actveroWorkbenchRuntime` in the Host entry and register a provider with the same identifier as the Client through `ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))`. Custom-storage providers enable native conversations with `ai: true` and may declare a local expert containing a name, version and instructions. When omitted, AI controls stay hidden and no conversation is created automatically. Only the optional `storage` adapter requires initial JSON, a reducer and action documentation. Legacy top-level `initial/reduce/actionHelp` registrations remain supported with AI enabled by default. An expert uses the conversation model without separate configuration. An optional preparation function can block binding or a later request on failure; it must not inject unrecorded model context.

A Host registration using only native AI can follow this example, without a JSON storage adapter or expert files. The business component calls its received `workbench.conversation()` to open or restore native chat; this does not send a business task. Register the Client component under the same package name. Optional first-use presentation `display` belongs in the Client descriptor, not `workbench.json`; saved user presentation choices take precedence.

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

The component receives a `workbench` context with its instance, associated conversation, runtime-directory lookup, AI availability, native resource address, conversation opening, business actions and public account information. `account()` returns null when signed out, otherwise only user and organization identifiers and names; these fields are not credentials. `models()` reads platform metadata through the controlled channel below. `conversation()` creates or restores the current associated conversation on demand, while `action()` writes using the latest revision. Pass an already registered package locale namespace to `register(descriptor, component, { locale: namespace })` for native typed `t` injection and language updates. Components observe native `useResource` data and adapt to their own container width. Floating previews scale a 960 × 640 business viewport, disabling internal interaction and scrolling; enter the workbench to edit.

The Host retains one stable default runtime instance per workbench. The JSON adapter shares its JSON across linked conversations; custom-storage authors own project organization and can associate conversations with individual objects through the API below. The global New conversation does not inherit it; New workbench conversation links the same instance. Reopening a conversation restores its association and expert version from the log. Collapsing does not detach, and detaching does not delete the checklist. New linked conversations create or reuse a workspace named after the workbench at `.sessions/<instanceId>` beneath the configured files root, separate from business data and without a folder picker. Existing conversations keep their directory.

See the runnable [built-in checklist provider](../packages/actvero/capability-ui/src/checklist.ts) and [Client](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx). Verify initially visible AI and conversation previews, independent collapse preferences and reload restoration, title-menu switching between linked conversations and their drafts, manual and tool edits to one checklist, concurrent conflicts, reopening conversations, detachment and narrow windows. Installation and UI acceptance do not replace real-model or organization-service verification.

<a id="conversation-objects"></a>

### Associate conversations with business objects

For project-, document-, or record-specific conversations, declare `protocol.hostApi: "^1.4.0"` in workbench.json and share that declaration between Host and Client. Implement the Host provider’s `resolveObject(objectId, environment, signal)`: check existence and access in your own storage and return `{ label }`; reject missing objects, denied access, or unavailable dependencies. Identifiers must remain stable within the instance and must not be reused for other objects; mutable names and transient UI selections are unsuitable identifiers. The Host creates no project table, copies no object content, and prescribes no storage format.

Call `workbench.conversation({ objectId })` to reuse a conversation associated with that object, creating one when no match exists; `fresh: true` creates another for that object. `objectId: null` explicitly selects the entire instance; omitting options preserves the existing association. Switching objects does not rebind another object’s conversation. New conversations inside the workbench retain the current associated object; ordinary new conversations do not inherit the workbench. `workbench.object` exposes the associated conversation’s recorded identifier and name for restoring its business view; it is not global selection state.

The Host calls `resolveObject` at binding and before each model step, supplying readonly `environment.object` to `prepare` and `activate`, or `null` for an instance-wide conversation. Custom tools capture this identifier; experts pass the target explicitly to MCP, CLI, or file operations instead of reading another window’s selection. Names are recorded at binding; later renames do not silently rewrite history. Failed preflight stops model requests and releases that conversation’s capabilities, retaining its association and business data; restore the object or explicitly select an available target before continuing. Preflight is not a transaction lock: authors still check existence, permissions, revisions, and conflicts at actual reads and writes. Generic tools from the optional JSON adapter remain instance-wide; they do not become object-level CRUD automatically.

Verify separate conversations and drafts for two objects, multiple conversations for one object, unchanged tool targets after view navigation, restart and fork restoration, request refusal after object deletion, and stale command-menu refusal after association changes. Object bindings use schemaVersion 2 of `actvero/workbench`; instance-wide bindings and detach records retain version 1. Current readers accept both; older readers reject version 2. Do not remove association events to accommodate older clients.

<a id="expert-bundle"></a>

## Bundled experts, Skill, MCP and CLI

This section is for authors configuring workbench AI behavior. The host provides native conversations, model selection, logging and conversation scopes; authors choose business tools, file formats and operations. Set only `ai: true` for ordinary AI, or `expert` for simple instructions. For complete dependencies, use `WorkbenchExpertBundle` from `@actvero/dsh-experts/workbench` without creating or summoning an ordinary expert record.

Put raw resources in the source root's `assets/`. `pack` preserves that directory under the existing package size and path checks; raw files under `src/` are not copied automatically. The Host entry below assumes compilation to `lib/index.js`; the Client continues to register its business component under the same identity.

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

`assets/expert.json` uses [ExpertManifest](../packages/actvero/experts/src/contracts.ts) fields. A workbench carries raw resources directly without first creating or importing a single-expert ZIP. The following complete minimum example declares one required Skill and a three-number version. Its `key` maps to `assets/dependencies.json`; keep both declarations consistent. A Skill with `load: "always"` joins the logged expert instructions; `on_demand` registers only the native catalog entry for native skill tools to read. Native invocation policy still applies.

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

The following `dependencies.json` pairs with that example and a supplied `skills/delivery/SKILL.md`. This is the workbench loader's dependency format, not the expert ZIP's platform-reference format.

```json
{
  "schemaVersion": 1,
  "skills": [{ "key": "delivery", "source": "local", "path": "skills/delivery" }]
}
```

For MCP, add `{ "key": "files", "label": "业务文件", "required": true }` to manifest `connectors`, and `{ "key": "files", "source": "local", "path": "mcp.json" }` to dependency `connectors`, then implement the file; undeclared bindings are rejected. For CLI, add `{ "name": "delivery", "path": "cli.mjs", "runtime": "node", "description": "Manage delivery files; see the skill for arguments." }` to dependency `cli`, include the script, and document arguments and data locations in the Skill. Omit unused capabilities rather than adding empty dependencies.

File paths are relative to the expert directory and cannot escape it, reference symbolic links, or be absolute. `skills/delivery/SKILL.md` uses native Skill parsing. Bindings must match manifest requirements; missing required dependencies prevent AI activation. An optional requirement without a binding or an absent installed skill is recorded in expert instructions; corrupt bound files or changed pinned versions still fail. CLI files declare `node`, `python` or `executable`; interpreters resolve on demand from the host's configured native runtime. Host authors may also provide explicit absolute interpreter paths through `runtimes`.

MCP binding files use native `dsh-mcp-client` configuration, for example `{ "transport": "stdio", "command": "${node}", "args": ["${bundle}/server.mjs"], "cwd": "${data}" }`. `${bundle}`, `${data}`, `${node}` and `${python}` in commands, arguments, working directories, environment values and HTTP URLs/headers expand to resource and business directories and native interpreters. Arguments pass as argv without shell expansion; native configuration owns reconnection and timeouts. Authors or services supply network authorization; distribution packages must not contain long-lived credentials. CLI declarations describe commands to the expert without executing them or installing dependencies; experts invoke them through native shell tools.

To reference an installed Skill, use `{ "key": "delivery", "source": "installed", "name": "delivery", "sha256": "pinned digest" }`. Skills without a local resource directory use SHA-256 of their UTF-8 body; directory-backed skills use `SHA256(JSON.stringify([body, directoryDigest]))`, where the directory digest feeds each sorted `[relativePath, fileSHA256]` JSON into SHA-256. Resume and every execution check current native catalog authorization and the digest; revocation or changes stop execution instead of using an old cached authorization. Platform dependency references and automatic download/installation are not connected.

The installed package is the local version cache. During a provider lifetime, `WorkbenchExpertBundle` reuses parsed resources by workbench version without network queries or repeated same-version parsing; do not edit installed resources under an unchanged version. Every conversation independently registers Skills and MCP connections. The Session records expert instructions and a dependency digest; a resume mismatch requires selecting the workbench again without silently rewriting existing events. Authors increase package and provider versions for upgrades; business files remain.

Authors may register business tools directly in `activate(ctx, environment, signal)`, or append native capabilities after `await bundle.activate(...)` and return its result. All registrations, listeners and child plugins belong to the supplied `ctx` and honor `signal`, without external global registries. On binding failure, the host releases all newly mounted capabilities and keeps the previous association record; the next execution prepares that association again. Detachment, conversation disposal and provider removal await capability release and the loading callback. Host `open()` and `environment()` calls do not start dependencies; closing the AI window does not detach an existing association.

Verify manual operations, direct business tools, Skill/CLI and MCP against the same business file and read it back from the business UI. Cover conversation isolation, repeated opening, missing dependencies, startup failure, cancellation, removal and restart. An unchanged workbench version reuses local resources offline; model and remote MCP requests may still require a network.

<a id="display"></a>

## Display control and Agent entry points

Workbench authors may register optional client metadata `display: { sidebar: 'focus', ai: 'hide' }` as first-use layout defaults. `focus` collapses left navigation without entering operating-system fullscreen; omission preserves navigation. `ai: 'hide'` retains the AI entry without proactively creating a conversation; omission restores an associated conversation when AI is enabled. Users toggle navigation with the host's top-left sidebar control and collapse floating windows from their upper-right controls; visibility preferences are saved separately and take precedence on subsequent opens. Leaving the business main view restores the preceding navigation expansion, while widths and narrow-window behavior follow the host layout rules.

Business components may also control presentation. These calls wait for the Client to mount the host view; they send no message and execute no expert tool.

```js
await workbench.display({ mode: 'business', sidebar: 'focus', ai: 'hide' })
await workbench.display({ mode: 'business', ai: 'show' })
await workbench.display({ mode: 'preview' })
const visible = workbench.displayState()
```

`business` uses the main content area, with `ai` showing or collapsing the AI window; `conversation` displays native conversation with the business preview collapsed; `preview` floats a business preview over native conversation. The latter modes require AI, reuse the associated conversation when available, and otherwise create a native associated conversation. Existing conversations must belong to the same runtime instance; repeated navigation reuses the instance and association. Business previews and AI windows remember visibility and positions separately; dragging or keyboard movement does not change business data. The preview is an inert scaled view; enter the business main view to edit.

Resident tools `workbench_list`, `workbench_open`, and `workbench_status` list loaded Host providers, choose presentation, and query the Client's actual view. They do not require a workbench selected in the calling thread. Agent business opens collapse AI by default without rebinding the running caller; explicit conversation or preview opens reuse a matching association or create another associated conversation. Bundled experts still define business tools; presentation tools grant no additional business permissions.

Extension API `1.7.0` adds `objectId` to business-mode presentation and `object_id` to `workbench_open`. The Client requires `objectNavigation`, validates the object through the Host provider’s `resolveObject`, and supplies it through `workbench.location` without rebinding the calling conversation. Direct navigation has no historical revision; saved-reference navigation retains its revision. Missing objects, unsupported navigation and non-business modes fail explicitly.

Only `status: 'confirmed'` acknowledges a mounted host view, not completion of all author-owned remote business requests. No Client returns `unavailable`, multiple Clients return `ambiguous`, and a view that cannot load returns `failed`; connection loss or exceeding `displayTimeoutMs` returns `unknown`, requiring inspection before another action. The default wait is 30 seconds, configurable in the capability package's Host configuration. Cancellation returns `cancelled` without deleting an instance or conversation already created; reconnect does not replay navigation. `workbench.display()` rejects unconfirmed outcomes, which callers should present as recoverable failures. UI-only cards can display but do not appear in the Host provider catalog and cannot create native conversations.

<a id="platform"></a>

## Identity and platform model directory

To read platform models, explicitly declare `platform: ['models:read']` on the Host provider and call `await workbench.models()` when needed. Results contain an account-generation `scope` and `models`; each model exposes `id`, `name`, `description` and `operations`, with `kind`, `inputModalities` and `outputModalities`. Image and video operations remain visible. Requests fail for undeclared capabilities, unloaded Host providers, signed-out users or unavailable organizations; local checklists remain usable.

The Host forwards requests to Electron Main, which uses the current account’s read-only model-directory grant against a fixed service. Results contain no resource tokens, service endpoints or custom request headers; workbenches cannot use this channel to send host credentials to arbitrary URLs. It only reads metadata, without a generic image/video generation, quota or upload proxy. Authors integrate third-party services themselves.

`scope` distinguishes account and organization request generations; it is not a credential. Sign-out, platform replacement and organization switching invalidate old reads. The directory is not cached; subsequent calls read the current authorization. Authors caching metadata must clear it on account changes and replace it using the new `scope`; business directories are not automatically partitioned by account. Cancellation, timeout, denied access, malformed responses and directory limits reject without returning partial results. `platformTimeoutMs` configures the Host wait, defaulting to 30 seconds; remote access requires the desktop owner.

The AI template’s “View available models” demonstrates the minimal integration. Signed-out access shows a recoverable message without requiring a separate expert model or automatically inserting account information or model metadata into conversations. Real platform permissions and paid generation require separate verification.

<a id="verify"></a>

## Local verification and troubleshooting

Developers and executing Agents use this table to record observable outcomes, selecting only capabilities the workbench uses. Mark each item passed, failed, pending verification or not applicable, with command output, screenshots or actual business results. Without model authorization, verify local business, packaging and dependencies while leaving actual model or external writes pending; do not submit paid generation automatically for acceptance.

| Check | Passing evidence |
|---|---|
| Package and code | Separate results for relevant business tests and project type checks; actual path, version, size and digest from `pack` and `check`; required resources present in the artifact |
| Installation inventory | Exact package name, version and state in the intended client/Profile, with `application` recorded; pending restart does not count as loaded |
| Sidebar entry | The item appears in Workbenches → My workbenches and enters the sidebar switcher after loading; a matching display name alone does not identify this package |
| Actual view | Open the business component from the switcher; artwork, copy, previews and first-use entry without a conversation work, beyond merely seeing the manager card |
| Business and storage | Complete one actual minimum flow and retain data after reopening and reload, using the actual directory or remote source rather than demonstration data alone |
| Native AI | Open or restore associated chat on demand; verify the adopted instructions, Skill, tools, MCP or CLI read and write the same business data, without granting them to unrelated conversations |
| Display and layout | Applicable business, chat and read-only preview modes; collapsed/reloaded preferences, expanded/collapsed sidebar, light/dark themes and narrow containers; realistic Chinese/English content without clipped controls, single-character columns or page-wide horizontal overflow |
| Updates and recovery | Data retained after update; existing chat resumes or explicitly requests reselection; preparation failures preserve the prior association and give a recoverable error |

`workbench_list` lists loaded Host providers only; verify UI-only workbenches through the manager and actual view. `workbench_open` returning `confirmed` establishes host-view mounting, not completion of remote requests or business-data acceptance. Query `workbench_status` after `unknown` rather than directly replaying installation or business operations.

| Symptom | Next action |
|---|---|
| Missing command or dependency | Check working directory, source-root `package.json`, Node/pnpm and locked dependencies; do not run repository commands from the business directory or start a substitute host |
| Package validation fails | Follow diagnostics for metadata, entries, resource sizes and paths, then rebuild from source rather than editing `.tgz` or installed files |
| `incompatible-version` | Compare target runtime and `engines.dsh`, then decide adaptation or a compatible client; changing a version number or granting an exemption does not establish compatibility |
| Installed but missing entry or blank view | Inspect installation outcome, enabled state and Host/Client errors, then both ids, registrations, injections and console diagnostics; request restart only when required |
| AI cannot open or operate | Separate disabled AI, preparation failure, unavailable model and missing tools; inspect `ai`, `activate`, resource bindings and interpreters. Custom storage does not automatically receive JSON tools |
| Manual and AI data differ | Check instance, project selection, actual directory or remote scope, and tool read/write locations; do not mask the discrepancy by copying another dataset |

Fix source and increase the version before installation updates. Do not rewrite Session logs, same-version installed resources or clear business directories to repair loading. Without target-client access, deliver the checked package, exact import entry and unverified items without claiming it loaded.

<a id="limits"></a>

## Limitations

This tool is a repository development entry, not a published general SDK. It accepts local `.tgz` packages without ZIP import, platform downloads, publishing or automatic updates; controlled platform access currently supports model-directory reads only. Expert dependencies load explicitly through Host `activate`; adding files does not enable them. The local loader does not download or install platform dependencies.

Packages target Actvero's workbench registration service. Legacy DSH workbenches use another service; changing a marker alone does not establish compatibility. The DSH reference is retained as an [offline snapshot](third-party/dsh-desktop-workbenches/development-guide.zh.md), version 2026-10-27; it is not the current online specification and does not replace these Actvero package rules.

The upstream reference was actually fetched online on 2026-11-08 from the final URL https://dshdesktop.com/workbench/docs/development.md with HTTP 200 and document version 2026-10-27; no offline substitute was used. This guide describes the current ACTVERO local framework and does not claim support for every upstream API.
