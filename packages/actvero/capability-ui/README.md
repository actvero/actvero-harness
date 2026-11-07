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

The Workbenches sidebar title opens management; its adjacent name opens the switcher. Business components occupy the main area without creating a conversation or asking for a directory on first open. The title and return control share the top row. AI-enabled workbenches open their native conversation from the circular bottom-right Ask AI button; the floating header groups new conversation, full conversation and collapse at the right; conversations also select them through Add → Workbenches. A removable composer badge identifies the selection, with floating and full workbench controls in the header. Collapsing preserves the current conversation and input draft for reopening from the launcher; detaching removes the conversation association and tools while retaining data. macOS window controls retain their safe area.

The workbench and expert managers share search controls, source tabs, responsive card grids and visual styling for icons, spacing and actions. My workbenches offers search; category filters appear only in the platform catalog. Compact workbench cards show a name, purpose, horizontally scrollable previews and an Open action; the name or previews open details. The built-in Project checklist includes five screenshots showing different progress states and dark mode for trying gallery navigation and enlargement. Missing or failed images show a placeholder. Registered metadata supplies artwork and author information; see [client contracts](src/contracts.ts) and [local package integration](../../../actvero/workbenches.md).

Workbench cards join the Plugin Manager inventory with registered business components; disabled or failed installed entries stay visible. Menus offer local version updates, enablement, disablement, and removal, with reviewed old and new versions. Failed reads retain the last list and block mutations; failed, cancelled, and overridden operations are reported separately from activation. The Host retains replacement restart state across page reloads. See [local workbench development](../../../actvero/workbench-development.md#install) for usage.

Host configuration requires `dataDirectory` for workbench files; the Actvero Profile supplies its isolated `actvero-workbench-data` directory. Native Storage Domain stores business documents, which updates and uninstall do not delete. Each provider currently has one default business instance that several conversations can share; a new conversation does not copy the checklist. The Session log restores the selected workbench, version and bundled expert instructions. An unavailable selected version blocks subsequent requests until the user selects a loaded version.

<details>
<summary>Workbench runtime</summary>

Host providers register initialization, business actions and optional expert instructions through Cordis effects. Actions carry the observed revision; concurrent edits are rejected and require a fresh read. Clients subscribe to saved results through native Resources, and full and floating views share the component. Native Session Projection restores associations; tools are registered in the conversation scope, and native request records retain prompts and tool calls. See the [Host provider](src/workbench-provider.ts) and [Client context](src/contracts.ts) definitions.

</details>

The client service `ctx.capabilityHub` opens an expert, skill or connector manager and displays transient notifications. Its interface is owned by [the client contracts](src/contracts.ts).

<a id="model-experience"></a>

## Model Experience

### Native capability selection

#### What the model sees

The manager and popup add no model context themselves. A skill selection inserts the native `/skill-name` command into the draft; an expert or connector selection changes Host-owned capabilities for the selected conversation. Sending a message still follows the native recorded Session path. A linked workbench supplies its name, version, optional expert instructions, business action documentation and conversation-scoped `workbench_read` and `workbench_action` tools. Tools read business data on request; browsing does not send it to the model, and account information is not injected into prompts. The native Session log records the selected environment and subsequent requests retain the actual prompts, tool schemas and results.

#### Token effect

Manager browsing and popup search consume no model tokens. Sending the chosen command or using enabled capabilities adds only the native request content described by their owning modules.

#### KV Cache effect

Opening or closing a menu changes no model request prefix. Capability changes affect later requests when the owning Host module supplies different instructions or tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Capability Center requires ACTVERO native bridges. Workbench account context exposes public user and organization identifiers only, without tokens, platform image/video service proxying, remote distribution or publication. Bundled experts currently provide instructions; placing MCP, Skill or CLI files in a directory does not load them. The basic development template remains a standalone UI example; the built-in Project checklist demonstrates native AI integration.

<a id="dev-note"></a>

### Dev Note

None.
