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

Registers Capability Center in the official sidebar, after Workbenches and before Plugins by default, to manage experts, skills and connectors. Skill and connector commands contribute to the official Add menu and use its searchable, keyboard-controlled popupSelect. Selectors contain capability rows only, without manager navigation. Each action receives the session captured at popup opening; inserting a skill keeps attachment chips and checks the draft revision.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

The three managers share source tabs, native icons and catalog skeletons. The skill picker reads the effective retained Session catalog, including directory skills and expert version pins. Both skill entry points insert a neutral atomic badge with the skill glyph; adding one preserves existing text and attachments and resumes typing after the badge. Missing connector artwork uses the link glyph, while expert rows retain portraits. Required MCP switches stay on and disabled; other configured connectors remain selectable alongside the expert.

The Workbenches sidebar row has two controls: the left title opens management, and the right name and arrow open the switcher together, showing Choose workbench when none is selected. The row shares one highlight only while the pointer is over it. Choosing an item opens it and remembers the selection. Drag right-side handles to sort, or focus a menu item and use Alt + ↑ / ↓. Ordering is saved locally with new workbenches appended; it does not affect selection or business data. Menu names show hover text only when truncated. Business components occupy the main area with the title and return control on the top row, without a directory picker. AI-enabled workbenches initially show a tall, narrow native conversation, docked at equal right and bottom margins until moved; its header groups new conversation, full conversation and collapse controls. The header displays the current conversation title; clicking it switches between conversations linked to the same business instance while preserving their drafts. The bottom-right brand icon reopens the collapsed conversation and its input draft, with a Use AI tooltip above it. The button has an opaque background both at rest and on hover. Selecting Add → Workbenches in a conversation displays a removable badge and an initially visible compact workbench preview at the top right; hover or keyboard focus exposes expand and collapse controls. AI visibility is saved locally per business instance, and preview visibility per conversation and instance. Returning or reloading restores each preference; fullscreen navigation does not change it. Detaching removes the conversation association and tools while retaining data. With the macOS sidebar collapsed, window controls and public navigation occupy a separate top strip, leaving the full main-content width for the business header below. Expanding the sidebar removes that strip.

Extension API `1.1.0` lets authors render the entire business header after the divider. The host retains public return by default, plus sidebar and window controls, and injects no business icon, name or navigation into a custom header. Without a header, it shows only the default icon and name. Workbenches own their content, layout and interaction; the older toolbar helper remains optional for compatibility. Body and header can share view state through one native Store handle and read business data through resources. Previews omit headers, and disposal removes both contributions. See [custom headers](../../../actvero/workbench-development.md#header).

Extension API `1.6.0` makes the public catalog return control optional and resolves business objects for the native AI launcher. Authors can use the entire header for business navigation and open the current project’s associated conversation; existing conversation targets remain unchanged by view navigation. See [custom headers](../../../actvero/workbench-development.md#header) for registration options and failure behavior.

Extension API `1.7.0` adds `objectId` to business-mode presentation and `object_id` to `workbench_open`. The Client requires `objectNavigation`, validates the object through the Host provider’s `resolveObject`, and supplies it through `workbench.location` without rebinding the calling conversation. Direct navigation has no historical revision; saved-reference navigation retains its revision. Missing objects, unsupported navigation and non-business modes fail explicitly.

The workbench and expert managers share search controls, source tabs, responsive card grids and visual styling for icons, spacing and actions. My workbenches offers search; category filters appear only in the platform catalog. Compact workbench cards reserve two description lines and a fixed preview height. Their footer shows the version, source and supplied author; only disabled, restart-required or failed states receive a status label. Names and previews open details. Details group version, source and author into one compact row, scroll long descriptions independently, and keep actions at the bottom. The optional Project checklist example includes five screenshots showing different progress states and dark mode for trying gallery navigation and enlargement. Missing or failed images show a placeholder. Native package metadata supplies shared workbench artwork with failed-image fallbacks; Client `iconUrl` remains supported without package artwork. Registered metadata supplies previews and author information; see [client contracts](src/contracts.ts) and [local package integration](../../../actvero/workbenches.md).

Workbench cards join the Plugin Manager inventory with registered business components; disabled or failed installed entries stay visible. Menus offer local version updates, the host-managed data folder, enablement, disablement and removal. The folder action requires an available native file manager and a loaded workbench. Disablement and removal require confirmation and retain local data directories and conversation history; updates display the old and new versions. Before changing installations, linked conversation activity is refreshed; running conversations or unavailable activity state block changes. Successful installation, enablement, disablement and removal update the inventory without a separate success notice. Failed reads retain the last list and block mutations; cancellation adds no notice, while failed, unknown and overridden outcomes are reported separately from activation. The Host retains replacement restart state across page reloads. See [workbench development](../../../actvero/workbench-development.md#install) for usage.

Local archive inspection distinguishes invalid files from incompatible extension API versions. An incompatibility displays the required and current host API versions and stops before installation; use a compatible application version and import again.

No business workbench is registered by default. Development and acceptance profiles may opt in to the Project checklist with `exampleWorkbench: true`; the client exposes it only while its Host provider is loaded. Empty catalogs retain the import and development entries.

Host configuration requires `dataDirectory` for workbench files; the Actvero Profile supplies its isolated `actvero-workbench-data` directory. The Host retains a stable instance and data directory per workbench. `environment()` exposes its directory, version and optional resources directory without a session. Authors may use files, SQLite or remote services and organize multiple business projects. Native Storage Domain stores only instance metadata and optional JSON-adapter state; new custom instances use a `json: "null"` metadata placeholder without copying business content; switching from JSON storage retains its content for author-managed migration. Updates, disable and uninstall retain directories; authors own concurrent writes, backups and data migration. A new conversation does not copy the checklist. The Session log restores the selected workbench, version and bundled expert instructions. An unavailable selected version blocks subsequent requests until the user selects a loaded version.

Workbench authors can declare first-use presentation defaults and call `workbench.display()` to select business, native conversation or preview modes; `displayState()` reads the mounted view. The host sidebar control toggles navigation, and leaving restores navigation expansion; AI and previews save visibility and positions separately. The Host channel accepts answering owner Clients only and succeeds after mount acknowledgement; disconnect or timeout remains unknown and is never replayed. See [display control](../../../actvero/workbench-development.md#display) for usage and failures.

The host provides public account context and a controlled model directory. The Host provider must explicitly declare `models:read`; responses contain read-only metadata without credentials or arbitrary URL proxying. `platformTimeoutMs` defaults to 30 seconds. The native `develop-workbench` and separate `workbench-frontend` Skills are bundled. Initialization creates a blank project, DESIGN.md and commands with the same toolchain’s guide and interface snapshots; frontend styling may be native, branded or custom. Compilation uses a built source toolchain outside the client. See the [development guide](../../../actvero/workbench-development.md#environment) for the toolchain, templates, installation and verification.

Extension API `1.2.0` inserts business selections as fixed snapshots into the associated native composer. References support removal, draft restoration and native user-message persistence; history remains readable after business-package uninstall. The API does not submit messages or fetch current business data. See [input references](../../../actvero/workbench-development.md#input-references) for integration and validation.

<details>
<summary>Workbench runtime</summary>

Host providers register metadata, an optional JSON adapter and expert instructions through Cordis effects. New providers enable native conversations with `ai: true`, defaulting to disabled; legacy top-level JSON providers retain their enabled default. New linked sessions use a separate `.sessions/<instanceId>` directory; existing session directories remain unchanged. Actions carry the observed revision; concurrent edits are rejected and require a fresh read. Clients subscribe to saved results through native Resources, and full and floating views share the component. The preview is scaled, read-only and non-scrolling; its window can be dragged and remembers its position locally. Native Session Projection restores associations; tools are registered in the conversation scope, and native request records retain prompts and tool calls. See the [Host provider](src/workbench-provider.ts) and [Client context](src/contracts.ts) definitions.

</details>

The client service `ctx.capabilityHub` opens an expert, skill or connector manager and displays transient notifications. Its interface is owned by [the client contracts](src/contracts.ts).

`WorkbenchProvider.activate` mounts author capabilities in a native conversation scope and returns an exact dependency digest plus optional expert instructions. Only successful binding records the result; failure releases new contributions and keeps the prior association event. Repeated activation reuses the live scope; detachment or provider removal awaits release. A changed digest on resume requires selecting the workbench again. The [bundled expert loader](../../../actvero/workbench-development.md#expert-bundle) reuses native Skills, MCP and interpreters without requiring generic JSON tools.

Host and Client registrations share [compatibility resolution](src/workbench-protocol.ts) before contributing effects; templates and archive preflight use the same requirements, documented in [package format](../../../actvero/workbench-development.md#format). Unregistration immediately withdraws availability, cancels preparation and activation, and waits for started calls and conversation scopes to settle; the identity remains reserved until completion, and repeated disposal awaits the same result. Preparation failure stops the model request and releases that conversation’s tools without changing its binding log or business data. Providers must observe AbortSignal, await their own tasks, and never await their own unregistration inside a callback; the host cannot forcibly stop uncooperative in-process code. Cordis releases contributions and logs cleanup exceptions; this does not guarantee rollback of external effects.

Extension API 1.3 adds native settings pages and associated-conversation commands through `register` options `settings` and `commands`. `openSettings(id)` addresses the provider page. Commands use native CommandContribution and recheck association before execution; disabling dismisses popups and removes all contributions. Settings persistence remains with native Host configuration or author-owned business storage; see the [developer guide](../../../actvero/workbench-development.md#settings-commands).

Extension API 1.4 supports optional business-object associations: providers validate author-defined identifiers through resolveObject, and Clients call conversation({ objectId }) to reuse or create a matching conversation. prepare/activate receive its fixed object; view navigation does not change the target, and failed validation stops model requests and withdraws capabilities. Logs retain the identifier and name without copying business data; authors still own storage and read/write authorization and conflicts. See the [development guide](../../../actvero/workbench-development.md#native-ai) for integration and recovery.

Extension API `1.5.0` adds visible automatic selection chips in associated native drafts, immutable business result cards and validated historical object navigation. Sending freezes reference content; old views cannot redirect it to another conversation. Result summaries and snapshots remain readable after a business package is removed. The AI checklist template demonstrates object conversations, input context and result metadata; see [business results](../../../actvero/workbench-development.md#business-results).

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

- Capability Center requires ACTVERO native bridges. Workbench account context exposes public user and organization identifiers only, without tokens, platform image/video service proxying, remote distribution or publication. Bundled experts explicitly activate native dependencies; adding files does not enable them. The basic development template remains a standalone UI example; the opt-in Project checklist demonstrates native AI integration.

<a id="dev-note"></a>

### Dev Note

None.
