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

The workbench and expert managers share search controls, source tabs, responsive card grids and visual styling for icons, spacing and actions. My workbenches offers search; category filters appear only in the platform catalog. Compact workbench cards show a name, purpose, horizontally scrollable previews and an Open action; the name or previews open details. The built-in Project checklist includes five screenshots showing different progress states and dark mode for trying gallery navigation and enlargement. Missing or failed images show a placeholder. Registered metadata supplies artwork and author information; see [client contracts](src/contracts.ts) and [local package integration](../../../actvero/workbenches.md).

The client service `ctx.capabilityHub` opens an expert, skill or connector manager and displays transient notifications. Its interface is owned by [the client contracts](src/contracts.ts).

<a id="model-experience"></a>

## Model Experience

### Native capability selection

#### What the model sees

The manager and popup add no model context themselves. A skill selection inserts the native `/skill-name` command into the draft; an expert or connector selection changes Host-owned capabilities for the selected conversation. Sending a message still follows the native recorded Session path.

#### Token effect

Manager browsing and popup search consume no model tokens. Sending the chosen command or using enabled capabilities adds only the native request content described by their owning modules.

#### KV Cache effect

Opening or closing a menu changes no model request prefix. Capability changes affect later requests when the owning Host module supplies different instructions or tool schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Capability Center requires the ACTVERO native bridges and owns no credentials. The workbench manager supports local packages and registered business components; platform distribution and conversation binding are not connected.

<a id="dev-note"></a>

### Dev Note

None.
