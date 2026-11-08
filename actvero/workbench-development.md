# Local workbench development

English | [中文](workbench-development.zh.md)

## Summary

This tutorial is for workbench developers with an Actvero repository development environment: start from the project checklist template, edit its business view, and build a local archive for the desktop client. No GitHub account, repository URL, or publishing service is required. The template uses this checkout's compiler; run the commands below from the repository root.

## Table of Contents

- [Create and package](#create)
- [Import and verify](#install)
- [Package format](#format)
- [Edit the business view](#business)
- [Runtime directories and custom storage](#storage)
- [Native AI and shared data](#native-ai)
- [Bundled experts, Skill, MCP and CLI](#expert-bundle)
- [Display control and Agent entry points](#display)
- [Identity and platform model directory](#platform)
- [Limitations](#limits)

<a id="create"></a>

## Create and package

You can also choose “Create a workbench” in the manager, copy the instructions and describe your goal in a new conversation. The native `develop-workbench` skill ships with a guide generated from this document at build time; it neither chooses the business purpose nor sends a task automatically. The commands currently require a source checkout and installed dependencies; the desktop does not include a standalone compiler.

Prepare repository dependencies using the [client development guide](workbenches.md). Creation requires a destination that does not exist, preserving existing files. The second argument is the stable package name; retain it across versions of the same workbench.

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist
pnpm run actvero:workbench pack .artifacts/my-checklist .artifacts/workbenches
pnpm run actvero:workbench check .artifacts/workbenches/local-my-checklist-1.0.0.tgz
pnpm run actvero:workbench create .artifacts/my-ai-checklist @local/my-ai-checklist --template ai
```

`create` defaults to the plain checklist; add `--template ai` for “AI 项目清单”, with native data, AI and a local expert Skill. Both templates work locally without sign-in; the AI template initially offers an AI entry without creating a conversation. Build dependencies come from the source development environment.

`create` copies the editable checklist; `pack` compiles Host and Client, generates the bundle patch, and reports the validated `.tgz`, byte count, and SHA-256. Packaging does not modify business sources, install, or publish. A same-named output replaces the previous artifact; a failed build preserves it. Omitting the output directory uses the project's `dist`.

`check` reuses desktop import preflight and checks the format marker, version declarations, nonempty entry files, and duplicate, escaping, or linked paths. It does not execute workbench code or establish business acceptance. Installation also checks compatibility with the current runtime; the development command does not bypass this check.

<a id="install"></a>

## Import and verify

Start the Actvero development client, open Workbenches → My workbenches, choose Import workbench, and select the output. If the result requires a restart, use Harness → Restart Harness. After loading, Project checklist appears in the catalog and sidebar switcher. The built-in example remains available for reference; the independent package's details show the author 本地开发 to distinguish it.

Open the independent package, check an item, return to the manager and reopen it, then reload the client and reopen it to verify saved progress. Check previews, expanded/collapsed sidebar, light/dark themes, and a narrow window. First use creates no conversation and requires no workspace selection. Verify the installation result, catalog entry, switcher, and actual business view separately.

To update, retain the package name, increase `package.json.version`, and rebuild. Select the archive through the card's More → Update version action or import it directly; confirmation shows the installed and incoming versions. Repeated versions, downgrades, mismatched names, and incompatible runtimes are refused. A successful replacement shows Restart required; after restarting Harness, check Loaded, the version, and business content. Independently stored data is retained; business schema migrations belong to the workbench.

The card's More menu offers disable, enable, and uninstall. Disabling retains the package in My workbenches across restarts; only loaded workbenches enter the sidebar switcher. Uninstall requires confirmation and retains independently stored data; importing the same package again restores the example checklist. On installation or update failure, inspect diagnostics and verify the inventory. Successful installation does not establish business acceptance.

<a id="format"></a>

## Package format

The format marker is `dsh.actveroWorkbench: 1`. Deliver an npm-compatible `.tgz` with contents under `package/`, at most 8 MiB compressed and 32 MiB unpacked. The npm package name provides stable identity; registration reads the display metadata from `workbench.json` and version from `package.json`.

| File or field | Purpose |
|---|---|
| `package.json.name` / `version` | Stable package name and complete SemVer version; the template registers under the package name |
| `package.json.icon` | Optional package artwork, for example `./assets/icon.svg`; SVG, PNG, JPEG or WebP, at most 256 KiB |
| `engines.dsh` | Supported DSH runtime range; the template pins the current development baseline |
| `dsh.bundle.patch` | Points to `./cordis.patch.yml`, adding the package to the current Profile |
| `dsh.client` | Declares the Web client and preceding dependencies including `@actvero/dsh-capability-ui` |
| `exports["."]` / `exports["./client"]` | This tool's `./lib/index.js` and `./lib/client.js` outputs |
| `exports["./locale/*.json"]` | Generated name and description metadata remains available before the workbench loads |
| `workbench.json` | Source display name, description, category, author, and tags, compiled into the Client |
| `src/client/assets/` | Source previews, bundled through image imports without remote image hosting |
| `src/index.ts` | Host plugin entry; the template has no Host business service |
| `src/client/index.ts` | Registers the card and component through a Cordis effect, removing them on disposal |

The artifact contains the manifest, generated patch, display `locale`, compiled `lib`, and optional raw `assets`. `repository` may be omitted. React uses the Host's shared instance; CSS Modules and images use the repository client compiler. Do not bundle a second React or Host plugin implementation into business code. Package validation checks format, not code confinement.

<a id="business"></a>

## Edit the business view

Edit card copy in `workbench.json`. Categories use the expert ecosystem's identifiers: `office`, `engineering`, `design`, `content`, `data`, `education`, `lifestyle`, `general`, and `uncategorized`. My workbenches omits category filtering, but packages may carry a category.

Edit the business view in `src/client/Checklist.tsx` and its CSS Module, and maintain bilingual copy in `locales.ts`. Declare preview imports in the Client entry. Put artwork in the package-root `assets/` directory and declare it once in `package.json`, for example `"icon": "./assets/icon.svg"`. The Host reuses it in cards, details, the switcher, the business title, the conversation picker, the composer badge and the floating-workbench control. Missing or failed artwork uses the native fallback. A Client `iconUrl` remains supported when package artwork is absent. Management and AI-assistant entries retain Host icons. See the [Client definitions](../packages/actvero/capability-ui/src/contracts.ts) for registration. Business content occupies the main area while the Host retains public navigation and window controls.

The example isolates browser local storage by package name and restores progress after reload. A failed read reports an error and disables changes instead of overwriting unreadable data. This storage belongs to the current client configuration; it provides no project, account, or organization isolation and no backup. Production business data requires its own storage design.

<a id="storage"></a>

## Runtime directories and custom storage

Register a Host provider to obtain a stable directory for local business storage. This entry does not enable AI or require JSON initialization and action methods; the Client still registers its business component under the same identifier.

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

`dataDirectory` is a writable business root at `<DSH home>/actvero-workbench-data/<instanceId>`; upgrades and reinstall preserve the instance identifier and path. Authors can organize multiple projects and choose files, JSON, SQLite or remote storage, owning concurrent writes, transactions, backups and format migrations. The Host does not maintain another copy of business content; new custom instances use `json: "null"` solely as a metadata placeholder; switching from a JSON adapter retains its content for author-managed migration. Native session logs and working directories are stored separately.

`resourcesDirectory` identifies package resources and must be absolute when declared; omission returns `null`, and the Host never writes there. Obtaining a path grants no AI or renderer filesystem permissions. Business components can query `await workbench.environment()`; UI-only workbenches return `null`. Actual file operations belong to author-provided Host services, MCP or CLI integrations. Directory creation failures are reported without falling back to temporary directories or overwriting existing files.

For host-managed JSON, register a `storage: { initial, reduce, actionHelp }` adapter; legacy top-level fields remain supported. Only this adapter supports generic `action()` and conversation JSON tools; generic actions against custom storage return `workbench/unsupported-storage`. Uninstall retains directories and instance records; business-data deletion is a separate operation.

<a id="native-ai"></a>

## Native AI and shared data

The basic template registers a business UI only. To support native conversations, inject `actveroWorkbenchRuntime` in the Host entry and register a provider with the same identifier as the Client through `ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))`. Custom-storage providers enable native conversations with `ai: true` and may declare a local expert containing a name, version and instructions. When omitted, AI controls stay hidden and no conversation is created automatically. Only the optional `storage` adapter requires initial JSON, a reducer and action documentation. Legacy top-level `initial/reduce/actionHelp` registrations remain supported with AI enabled by default. An expert uses the conversation model without separate configuration. An optional preparation function can block binding or a later request on failure; it must not inject unrecorded model context.

The component receives a `workbench` context with its instance, associated conversation, runtime-directory lookup, AI availability, native resource address, conversation opening, business actions and public account information. `account()` returns null when signed out, otherwise only user and organization identifiers and names; these fields are not credentials. `models()` reads platform metadata through the controlled channel below. `conversation()` creates or restores the current associated conversation on demand, while `action()` writes using the latest revision. Pass an already registered package locale namespace to `register(descriptor, component, { locale: namespace })` for native typed `t` injection and language updates. Components observe native `useResource` data and adapt to their own container width. Floating previews scale a 960 × 640 business viewport, disabling internal interaction and scrolling; enter the workbench to edit.

The Host retains one stable default runtime instance per workbench. The JSON adapter shares its JSON across linked conversations; custom-storage authors own project organization and conversation-to-project associations. The global New conversation does not inherit it; New workbench conversation links the same instance. Reopening a conversation restores its association and expert version from the log. Collapsing does not detach, and detaching does not delete the checklist. New linked conversations create or reuse a workspace named after the workbench at `.sessions/<instanceId>` beneath the configured files root, separate from business data and without a folder picker. Existing conversations keep their directory.

See the runnable [built-in checklist provider](../packages/actvero/capability-ui/src/checklist.ts) and [Client](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx). Verify initially visible AI and conversation previews, independent collapse preferences and reload restoration, title-menu switching between linked conversations and their drafts, manual and tool edits to one checklist, concurrent conflicts, reopening conversations, detachment and narrow windows. Installation and UI acceptance do not replace real-model or organization-service verification.

<a id="expert-bundle"></a>

## Bundled experts, Skill, MCP and CLI

This section is for authors configuring workbench AI behavior. The host provides native conversations, model selection, logging and conversation scopes; authors choose business tools, file formats and operations. Set only `ai: true` for ordinary AI, or `expert` for simple instructions. For complete dependencies, use `WorkbenchExpertBundle` from `@actvero/dsh-experts/workbench` without creating or summoning an ordinary expert record.

Put raw resources in the source root's `assets/`. `pack` preserves that directory under the existing package size and path checks; raw files under `src/` are not copied automatically. The Host entry below assumes compilation to `lib/index.js`; the Client continues to register its business component under the same identity.

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

`assets/expert.json` uses the existing [expert manifest format](expert-package.md): `schemaVersion`, `id`, `name`, `description`, complete version and `instructions`, plus Skill/MCP requirements. Requirement keys match bindings in `assets/dependencies.json`. Skill `load: "always"` adds its body to recorded expert instructions; `on_demand` only registers the native catalog entry for the native skill tool to load. Native skill invocation policies still apply.

```json
{
  "schemaVersion": 1,
  "skills": [{ "key": "delivery", "source": "local", "path": "skills/delivery" }],
  "connectors": [{ "key": "files", "source": "local", "path": "mcp.json" }],
  "cli": [{ "name": "delivery", "path": "cli.mjs", "runtime": "node", "description": "Manage delivery files; see the skill for arguments." }]
}
```

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

Only `status: 'confirmed'` acknowledges a mounted host view, not completion of all author-owned remote business requests. No Client returns `unavailable`, multiple Clients return `ambiguous`, and a view that cannot load returns `failed`; connection loss or exceeding `displayTimeoutMs` returns `unknown`, requiring inspection before another action. The default wait is 30 seconds, configurable in the capability package's Host configuration. Cancellation returns `cancelled` without deleting an instance or conversation already created; reconnect does not replay navigation. `workbench.display()` rejects unconfirmed outcomes, which callers should present as recoverable failures. UI-only cards can display but do not appear in the Host provider catalog and cannot create native conversations.

<a id="platform"></a>

## Identity and platform model directory

To read platform models, explicitly declare `platform: ['models:read']` on the Host provider and call `await workbench.models()` when needed. Results contain an account-generation `scope` and `models`; each model exposes `id`, `name`, `description` and `operations`, with `kind`, `inputModalities` and `outputModalities`. Image and video operations remain visible. Requests fail for undeclared capabilities, unloaded Host providers, signed-out users or unavailable organizations; local checklists remain usable.

The Host forwards requests to Electron Main, which uses the current account’s read-only model-directory grant against a fixed service. Results contain no resource tokens, service endpoints or custom request headers; workbenches cannot use this channel to send host credentials to arbitrary URLs. It only reads metadata, without a generic image/video generation, quota or upload proxy. Authors integrate third-party services themselves.

`scope` distinguishes account and organization request generations; it is not a credential. Sign-out, platform replacement and organization switching invalidate old reads. The directory is not cached; subsequent calls read the current authorization. Authors caching metadata must clear it on account changes and replace it using the new `scope`; business directories are not automatically partitioned by account. Cancellation, timeout, denied access, malformed responses and directory limits reject without returning partial results. `platformTimeoutMs` configures the Host wait, defaulting to 30 seconds; remote access requires the desktop owner.

The AI template’s “View available models” demonstrates the minimal integration. Signed-out access shows a recoverable message without requiring a separate expert model or automatically inserting account information or model metadata into conversations. Real platform permissions and paid generation require separate verification.

<a id="limits"></a>

## Limitations

This tool is a repository development entry, not a published general SDK. It accepts local `.tgz` packages without ZIP import, platform downloads, publishing or automatic updates; controlled platform access currently supports model-directory reads only. Expert dependencies load explicitly through Host `activate`; adding files does not enable them. The local loader does not download or install platform dependencies.

Packages target Actvero's workbench registration service. Legacy DSH workbenches use another service; changing a marker alone does not establish compatibility. The DSH reference is retained as an [offline snapshot](third-party/dsh-desktop-workbenches/development-guide.zh.md), version 2026-10-27; it is not the current online specification and does not replace these Actvero package rules.

The upstream reference was actually fetched online on 2026-11-08 from the final URL https://dshdesktop.com/workbench/docs/development.md with HTTP 200 and document version 2026-10-27; no offline substitute was used. This guide describes the current ACTVERO local framework and does not claim support for every upstream API.
