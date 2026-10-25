---
description: "Create, import or select an expert with its instructions, skills and connector requirements. Conversations retain an exact expert snapshot for resume and forks. Required dependencies must remain available and authorized before execution."
kind: "package-reference"
---

# Experts and immutable conversation snapshots

English | [中文](README.zh.md)

## Summary

Create, import or select an expert with its instructions, skills and connector requirements. Conversations retain an exact expert snapshot for resume and forks. Required dependencies must remain available and authorized before execution.

## Table of Contents

- [Runtime](#runtime)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="runtime"></a>

## Runtime

Preserves the existing local and platform expert manager, ZIP and legacy JSON import, starter prompts and AI creation. The native expert popup lists recently summoned experts in recorded order. It contains no ordinary-mode or manager navigation row. Summoning from a conversation uses its workspace; the manager requests a workspace only when it cannot infer one. A started conversation creates a new expert conversation.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

The detail dialog gives Summon, Export and the local-only Delete action equal-size native buttons with an 8px gap. Deleting asks for confirmation, removes only the local expert record, keeps existing conversation snapshots and leaves its installed skills and MCP connections available for reuse, so the same package can be imported again. Recent selector rows show the expert portrait with an initial fallback. The composer displays the expert portrait and name through its native left slot before permissions. Hover or keyboard focus exposes the portrait’s remove action; the name reopens the same native picker without changing the draft. Removing the expert leaves subsequent requests without an expert. Conversation connector switches remain open after toggling; a required dependency uses a disabled on switch with a localized tooltip. Off choices survive replay, forks and the next activation, independently of connection health.

The ACTVERO desktop does not seed a default expert. Local experts enter My experts through creation or the single-expert ZIP/JSON import flow.

Platform details reuse preparation only when the release ID and digest match. A different release clears its preparation and resolves exact dependencies again; installed skill versions are reused after file and digest verification. Current-cache recovery discards mixed-release preparation only after verifying the account, expert envelope and same-platform expert endpoints, then fetching the selected release successfully. Invalid digests, foreign endpoints and other-account records remain rejected. Concurrent preparations share work, and account or release changes prevent stale commits. Each summon checks the selected release. Conversation snapshots retain their original release and authorization checks.

A summon reuses its verified runtime only inside one Main-owned selection operation. Preparation, activation and the final Host check share the result; completion, failure, account changes and skill installation changes discard it. Later model steps still validate current grants and exact files. Local preparation reads only bound skills and skips connector discovery when the expert has no connector requirements. The latest release resolve supplies dependency and update status without repeated per-skill catalog requests.

Selecting an expert overlays its exact skill versions and connector requirements on the native capabilities. It does not hide unrelated native skills or already added MCP configurations. A same-name skill resolves to the verified expert version, and a failed pin validation still rejects the view instead of falling back to discovered content.

The Host adapter `ctx.actveroExpertPolicy` resolves the permitted connector IDs for an agent from its expert snapshot and conversation choices. An undefined selection leaves the ordinary connector policy in control; an empty selection permits none. Its object interface and provider live in [the Host plugin](src/index.ts).

Platform catalog cards compare the locally retained release with the latest release and show version changes. DSH Toast announces available updates when the catalog is opened or refreshed. Detail previews retain this status until preparation succeeds; preparation shows both versions. Existing conversation selections retain their snapshot name, version and avatar. Every portrait accepted by the manifest is also accepted by the session projection.

<a id="model-experience"></a>

## Model Experience

### Expert persona and dependencies

#### What the model sees

The Host adds the selected expert name, version, instructions and always-loaded verified skill blocks to its `actvero_expert` system-prompt variable. It exposes scoped MCP capabilities and the `expert_catalog` and `expert_create` local creation tools. The native Session projections record the immutable expert selection and scoped connector choices. Required expert connectors stay on; optional connectors can be disabled for this conversation.

#### Token effect

Expert instructions, always-loaded skill content, selected tool schemas and returned results contribute tokens to native requests. Merely browsing or selecting an expert does not submit a turn.

#### KV Cache effect

A different expert selection creates a new conversation after the original has started. Resuming or forking preserves the recorded expert snapshot, so an upstream release does not silently rewrite its persona or dependency content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Exact expert snapshots and dependency references are recorded as actvero/expert session events and read through the native projection registry. Resume and forks preserve the snapshot; new releases do not replace existing conversation dependencies. Resource access is checked again before execution. Release v3 requires verified MCP semantic references for all supported capability kinds. A local expert can be exported and imported using the [single-expert package format](../../../actvero/expert-package.md). New MCP templates are saved disabled. Platform dependencies retain exact references and require current authorization; importing does not upload to the platform.

<a id="dev-note"></a>

### Dev Note

None.
