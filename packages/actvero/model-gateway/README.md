---
description: "Use Actvero platform models through the desktop account, with platform-owned routing and short-lived resource authorization."
kind: "package-reference"
---

# @actvero/dsh-model-gateway

English | [中文](README.zh.md)

## Summary

Use models available to the selected Actvero account and organization through the native model picker. The platform supplies model metadata, routing and resource authorization. The adapter supports OpenAI-compatible chat responses and requires the Actvero Electron Main bridge for access.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

The [Actvero desktop composition](../../../actvero/README.md) mounts the plugin beside the native `llm` service. Select the platform provider in the model picker after connecting an eligible account. The platform owns endpoint and model access settings; this plugin accepts an empty configuration object and exposes no editable provider credential fields.

The plugin requests `llm:catalog` and per-model `llm:<model-uuid>` resource tokens from Electron Main. Long-lived login credentials remain in Main storage. The Host uses short-lived tokens for catalog and generation requests; the renderer receives no bearer tokens. Without the Main IPC channel, the plugin registers its settings row but cannot provide a model adapter.

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [adapter](src/index.ts) maps platform chat models to DSH model metadata, prepares a resource-specific route and converts native messages and tool schemas to OpenAI-compatible requests. Responses are converted from SSE or buffered JSON into native text, reasoning, tool-call, usage and finish chunks. Account changes invalidate catalog data through the Main bridge.

Image messages use the attachment service to obtain bounded request bytes. File attachments are represented by their native text handles. Cancellation and platform HTTP failures propagate as native LLM errors.

</details>

<a id="model-experience"></a>

## Model Experience

### Platform chat requests

#### What the model sees

The selected platform model receives the native system prompt, conversation messages and supported images through `messages`, plus enabled tool schemas through `tools`. Account screens, catalog browsing and login credentials do not become prompt content. Returned text, reasoning and tool calls follow the normal DSH recording path.

#### Token effect

Prompt text, history, tool schemas and image content contribute to the selected model's request. Catalog refresh creates no generation request. Reported usage comes from the platform response; available cached-input counts are separated from uncached input.

#### KV Cache effect

Catalog browsing changes no prompt prefix. Model selection, conversation content and enabled capabilities can change later requests; cache reuse depends on the selected platform provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The adapter requires the Actvero desktop IPC bridge and an available platform account. Standalone Host processes have no platform adapter.
- The transport implements OpenAI-compatible chat generation. Catalog entries outside the supported chat operation do not establish support for other model protocols or media-generation APIs.
- Image requests require the native attachment service. The platform controls model access and the lifetime of resource tokens.

<a id="dev-note"></a>

### Dev Note

Verification of real-account model access belongs to the owning Actvero deployment; repository documentation checks do not exercise that external service.
