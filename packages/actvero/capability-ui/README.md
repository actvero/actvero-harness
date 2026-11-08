---
description: "Browse experts, skills and connectors from the desktop sidebar and select capabilities for a conversation. Shared pickers preserve the current draft and attachments. Native bridges supply the available resources and keep credentials outside the renderer."
kind: "package-reference"
---

# Native capability navigation

English | [中文](README.zh.md)

## Summary

Browse experts, skills and connectors from the desktop sidebar and select capabilities for a conversation. Shared pickers preserve the current draft and attachments. Native bridges supply the available resources and keep credentials outside the renderer.

## Table of Contents

- [Runtime](#runtime)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="runtime"></a>

## Runtime

Registers Capability Center in the official sidebar to manage experts, skills and connectors. Skill and connector commands contribute to the official Add menu and use its searchable, keyboard-controlled popupSelect. Selectors contain capability rows only, without manager navigation. Each action receives the session captured at popup opening; inserting a skill keeps attachment chips and checks the draft revision.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

The three managers share source tabs, native icons and catalog skeletons. The skill picker reads the effective retained Session catalog, including directory skills and expert version pins. Both skill entry points insert a neutral atomic badge with the skill glyph; adding one preserves existing text and attachments and resumes typing after the badge. Missing connector artwork uses the link glyph, while expert rows retain portraits. Required MCP switches stay on and disabled; other configured connectors remain selectable alongside the expert.

The Workbenches sidebar title opens management; its adjacent name opens the switcher. Business components occupy the main area with the title and return control on the top row, without a directory picker. AI-enabled workbenches initially show a tall, narrow native conversation, docked at equal right and bottom margins until moved; its header groups new conversation, full conversation and collapse controls. The header displays the current conversation title; clicking it switches between conversations linked to the same business instance while preserving their drafts. The bottom-right brand icon reopens the collapsed conversation and its input draft, with a Use AI tooltip above it. Selecting Add → Workbenches in a conversation displays a removable badge and an initially visible compact workbench preview at the top right; hover or keyboard focus exposes expand and collapse controls. AI visibility is saved locally per business instance, and preview visibility per conversation and instance. Returning or reloading restores each preference; fullscreen navigation does not change it. Detaching removes the conversation association and tools while retaining data. macOS window controls retain their safe area.

The workbench and expert managers share search controls, source tabs, responsive card grids and visual styling for icons, spacing and actions. My workbenches offers search; category filters appear only in the platform catalog. Compact workbench cards reserve two description lines and a fixed preview height. Their footer shows the version, source and supplied author; only disabled, restart-required or failed states receive a status label. Names and previews open details. Details group version, source and author into one compact row, scroll long descriptions independently, and keep actions at the bottom. The built-in Project checklist includes five screenshots showing different progress states and dark mode for trying gallery navigation and enlargement. Missing or failed images show a placeholder. Native package metadata supplies shared workbench artwork with failed-image fallbacks; Client `iconUrl` remains supported without package artwork. Registered metadata supplies previews and author information; see [client contracts](src/contracts.ts) and [local package integration](../../../actvero/workbenches.md).

Workbench cards join the Plugin Manager inventory with registered business components; disabled or failed installed entries stay visible. Menus offer local version updates, the host-managed data folder, enablement, disablement and removal. The folder action requires an available native file manager and a loaded workbench. Disablement and removal require confirmation and retain local data directories and conversation history; updates display the old and new versions. Before changing installations, linked conversation activity is refreshed; running conversations or unavailable activity state block changes. Successful installation, enablement, disablement and removal update the inventory without a separate success notice. Failed reads retain the last list and block mutations; cancellation adds no notice, while failed, unknown and overridden outcomes are reported separately from activation. The Host retains replacement restart state across page reloads. See [workbench development](../../../actvero/workbench-development.md#install) for usage.

Host configuration requires `dataDirectory` for workbench files; the Actvero Profile supplies its isolated `actvero-workbench-data` directory. The Host retains a stable instance and data directory per workbench. `environment()` exposes its directory, version and optional resources directory without a session. Authors may use files, SQLite or remote services and organize multiple business projects. Native Storage Domain stores only instance metadata and optional JSON-adapter state; new custom instances use a `json: "null"` metadata placeholder without copying business content; switching from JSON storage retains its content for author-managed migration. Updates, disable and uninstall retain directories; authors own concurrent writes, backups and data migration. A new conversation does not copy the checklist. The Session log restores the selected workbench, version and bundled expert instructions. An unavailable selected version blocks subsequent requests until the user selects a loaded version.

Workbench authors can declare first-use presentation defaults and call `workbench.display()` to select business, native conversation or preview modes; `displayState()` reads the mounted view. The host sidebar control toggles navigation, and leaving restores navigation expansion; AI and previews save visibility and positions separately. The Host channel accepts answering owner Clients only and succeeds after mount acknowledgement; disconnect or timeout remains unknown and is never replayed. See [display control](../../../actvero/workbench-development.md#display) for usage and failures.

The host provides public account context and a controlled model directory. The Host provider must explicitly declare `models:read`; responses contain read-only metadata without credentials or arbitrary URL proxying. `platformTimeoutMs` defaults to 30 seconds. The native `develop-workbench` and separate `workbench-frontend` Skills are bundled. Initialization creates a blank project, DESIGN.md and commands with the same toolchain’s guide and interface snapshots; frontend styling may be native, branded or custom. Compilation uses a built source toolchain outside the client. See the [development guide](../../../actvero/workbench-development.md#environment) for the toolchain, templates, installation and verification.

<details>
<summary>Workbench runtime</summary>

Host providers register metadata, an optional JSON adapter and expert instructions through Cordis effects. New providers enable native conversations with `ai: true`, defaulting to disabled; legacy top-level JSON providers retain their enabled default. New linked sessions use a separate `.sessions/<instanceId>` directory; existing session directories remain unchanged. Actions carry the observed revision; concurrent edits are rejected and require a fresh read. Clients subscribe to saved results through native Resources, and full and floating views share the component. The preview is scaled, read-only and non-scrolling; its window can be dragged and remembers its position locally. Native Session Projection restores associations; tools are registered in the conversation scope, and native request records retain prompts and tool calls. See the [Host provider](src/workbench-provider.ts) and [Client context](src/contracts.ts) definitions.

</details>

The client service `ctx.capabilityHub` opens an expert, skill or connector manager and displays transient notifications. Its interface is owned by [the client contracts](src/contracts.ts).

`WorkbenchProvider.activate` mounts author capabilities in a native conversation scope and returns an exact dependency digest plus optional expert instructions. Only successful binding records the result; failure releases new contributions and keeps the prior association event. Repeated activation reuses the live scope; detachment or provider removal awaits release. A changed digest on resume requires selecting the workbench again. The [bundled expert loader](../../../actvero/workbench-development.md#expert-bundle) reuses native Skills, MCP and interpreters without requiring generic JSON tools.

Host and Client registrations share [compatibility resolution](src/workbench-protocol.ts) before contributing effects; templates and archive preflight use the same requirements, documented in [package format](../../../actvero/workbench-development.md#format). Unregistration immediately withdraws availability, cancels preparation and activation, and waits for started calls and conversation scopes to settle; the identity remains reserved until completion, and repeated disposal awaits the same result. Preparation failure stops the model request and releases that conversation’s tools without changing its binding log or business data. Providers must observe AbortSignal, await their own tasks, and never await their own unregistration inside a callback; the host cannot forcibly stop uncooperative in-process code. Cordis releases contributions and logs cleanup exceptions; this does not guarantee rollback of external effects.

<a id="model-experience"></a>

## Model Experience

### Native capability selection

#### What the model sees

The manager and popup add no model context themselves. A skill selection inserts the native `/skill-name` command into the draft; an expert or connector selection changes Host-owned capabilities for the selected conversation. Sending a message still follows the native recorded Session path. A linked workbench supplies its name, version, optional expert instructions, business action documentation and, only with a JSON adapter, conversation-scoped `workbench_read` and `workbench_action` tools. Custom-storage authors provide their own tools and instructions. Tools read business data on request; browsing does not send it to the model, and account information is not injected into prompts. The native Session log records the selected environment and subsequent requests retain the actual prompts, tool schemas and results. The Host registers resident `workbench_list`, `workbench_open`, and `workbench_status` without a selected workbench. Results distinguish confirmation, failure, cancellation and unknown outcomes; native tool cards show catalog, navigation or inspection. The catalog lists Host providers only; catalog and display queries send no business data.

#### Token effect

Manager browsing and popup search consume no model tokens. Resident display-tool schemas join subsequent model requests, and their results follow native logging. Sending the chosen command or using enabled capabilities adds only the native request content described by their owning modules.

#### KV Cache effect

Opening or closing a menu changes no model request prefix. Capability changes affect later requests when the owning Host module supplies different instructions or tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Capability Center requires ACTVERO native bridges. Workbench account context exposes public user and organization identifiers only, without tokens, platform image/video service proxying, remote distribution or publication. Bundled experts explicitly activate native dependencies; adding files does not enable them. The basic development template remains a standalone UI example; the built-in Project checklist demonstrates native AI integration.

<a id="dev-note"></a>

### Dev Note

None.
