---
description: "Add platform or local MCP connections and choose which conversations can use them. Discover tools, prompts and resources through the negotiated MCP protocol. Device enablement and current authorization continue to restrict every conversation choice."
kind: "package-reference"
---

# MCP connections and session selection

English | [中文](README.zh.md)

## Summary

Add platform or local MCP connections and choose which conversations can use them. Discover tools, prompts and resources through the negotiated MCP protocol. Device enablement and current authorization continue to restrict every conversation choice.

## Table of Contents

- [Runtime](#runtime)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="runtime"></a>

## Runtime

Manages platform MCP services and local stdio, Streamable HTTP and SSE configurations. Discovery preserves Tools, Prompts, Resources and Resource Templates with pagination. Protocol versions and capabilities are negotiated before use. Selected capabilities become tools only in the selected agent scope; native calls retain cancellation.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

Conversation switches preserve intent through native Session events, including Host restart and forks; required expert dependencies remain on and disabled in the selector. Platform choices are isolated by platform, account and organization. A conversation choice neither grants authorization nor globally enables a disabled configuration. Expert ZIP templates remove credential values, reject device-specific paths and require pinned stdio packages. New templates are saved disabled without launching a process or OAuth flow.

Local MCP configuration uses system-encrypted storage in Electron Main. Missing files start empty; unavailable storage and undecryptable files return distinct errors while retaining the original ciphertext. Failed queries keep any previously loaded rows visible.

Platform connectors and Local connectors use the same source tabs and card layout. Local cards expose device enablement and connection status, and open the existing configuration form directly. The conversation selector includes all added connectors after selecting an expert, with expert requirements overlaid on matching entries. Required dependencies remain enabled and disabled for interaction; optional and additional connectors retain scoped choices. A failed catalog refresh offers Retry without discarding loaded rows.

The Host adapter `ctx.actveroMcp` refreshes agent-scoped registrations and reports registered connector IDs and tool names for a session. It delegates authority and discovery to Electron Main and applies the expert policy before registration and execution. Its object interface is declared in [the Host plugin](src/index.ts).

<a id="model-experience"></a>

## Model Experience

### Scoped MCP capabilities

#### What the model sees

The Host registers MCP tools, prompts, resources and resource templates for the permitted agent, using `mcp_` names derived from the connection and capability. Calls return canonical MCP results through the native tool runtime. Personal tokens and OAuth state never enter those schemas or results.

#### Token effect

Enabled schemas and returned capability content consume model tokens through native tools; browsing the connector manager, authorization and connection tests do not create a model request.

#### KV Cache effect

Changing the enabled capability set changes future tool schemas and can affect the cached prefix. Reusing a personal connection avoids repeated initial authorization but does not skip live permission checks.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Platform tokens and upstream credentials stay in Electron Main. Personal authorization is reused until it expires or becomes invalid. A transient discovery failure preserves the last inventory; actual calls still validate access. Conversation intent is restored from Session events; expert dependencies are restored from their exact snapshot. Removing a service from a device and disconnecting personal authorization have different scopes.

<a id="dev-note"></a>

### Dev Note

None.
