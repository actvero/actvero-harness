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

Preserves the existing local and platform expert manager, ZIP and legacy JSON import, starter prompts and AI creation. The native expert popup lists recently summoned experts in recorded order. It contains no ordinary-mode or manager navigation row. Summoning preserves the current idle conversation and its workspace without requiring another directory. Started idle conversations can switch experts while retaining history. Installed workbenches contribute source-labelled experts for their package lifetime; they cannot be deleted as personal experts.

Enable through the ACTVERO desktop composition (`ACTVERO_DESKTOP=1`). The owning Electron Main runtime provides the resource authority; client scripts do not discover sibling repositories or store bearer tokens.

The detail dialog gives Summon, Export and the local-only Delete action equal-size native buttons with an 8px gap. Deleting asks for confirmation, removes only the local expert record, keeps existing conversation snapshots and leaves its installed skills and MCP connections available for reuse, so the same package can be imported again. Recent selector rows show the expert portrait with an initial fallback. The composer shows the expert before permissions and reduces it to a portrait when the toolbar runs out of space. The name or compact portrait opens the native picker without changing the draft. The picker offers a stop action; the full chip also exposes that action over the portrait on hover or keyboard focus. Removing the expert leaves subsequent requests without an expert. Conversation connector switches remain open after toggling; a required dependency uses a disabled on switch with a localized tooltip. Off choices survive replay, forks and the next activation, independently of connection health.

The ACTVERO desktop does not seed a default expert. Local experts enter My experts through creation or the single-expert ZIP/JSON import flow.

Create expert opens a choice dialog. Create in Harness inserts a removable `expert-creator` skill chip and an editable request in the composer. Use another Agent copies the full Skill entrypoint and local development connection without starting a conversation. External Agents can maintain local experts through the CLI, or deliver JSON for import and binding when the connection is unavailable. Replace the placeholders for the area of expertise, main tasks and expected results with your own details before sending. The creation skill first uses existing context to understand the work setting, inputs and delivery criteria. A name or broad purpose alone leads to focused questions and a wait for the user's reply before saving. Material choices are presented in an editable plan for feedback. An explicit save request for an already clear plan proceeds without another interview. The skill checks dependencies for the plan and supports iteration on real tasks; saving, dependency readiness and actual trial results are reported separately. If an image generator is available in the conversation and its output can be saved as an avatar, the user can choose to generate one. Creation can continue with the default avatar.

Ask the skill to update an existing expert by name or ID. For My experts it reads the current revision, saves the requested fields and checks the saved dependencies. Supplied arrays and binding maps replace their corresponding values. A stale revision rejects the edit. For a platform organization the skill uses the separately installed and authenticated `actvero` CLI to manage expert drafts, skill versions and MCP configurations. The CLI's own help supplies its schemas and command syntax.

Platform details reuse preparation only when the release ID and digest match. A different release clears its preparation and resolves exact dependencies again; installed skill versions are reused after file and digest verification. Current-cache recovery discards mixed-release preparation only after verifying the account, expert envelope and same-platform expert endpoints, then fetching the selected release successfully. Invalid digests, foreign endpoints and other-account records remain rejected. Concurrent preparations share work, and account or release changes prevent stale commits. Each summon checks the selected release. Conversation snapshots retain their original release and authorization checks.

A summon reuses its verified runtime only inside one Main-owned selection operation. Preparation, activation and the final Host check share the result; completion, failure, account changes and skill installation changes discard it. Later model steps still validate current grants and exact files. Local preparation reads only bound skills and skips connector discovery when the expert has no connector requirements. The latest release resolve supplies dependency and update status without repeated per-skill catalog requests.

Selecting an expert overlays its exact skill versions and connector requirements on the native capabilities. It does not hide unrelated native skills or already added MCP configurations. A same-name skill resolves to the verified expert version, and a failed pin validation still rejects the view instead of falling back to discovered content.

The Host adapter `ctx.actveroExpertPolicy` resolves the permitted connector IDs for an agent from its expert snapshot and conversation choices. An undefined selection leaves the ordinary connector policy in control; an empty selection permits none. Its object interface and provider live in [the Host plugin](src/index.ts).

Platform catalog cards compare the locally retained release with the latest release and show version changes. DSH Toast announces available updates when the catalog is opened or refreshed. Detail previews retain this status until preparation succeeds; preparation shows both versions. Existing conversation selections retain their snapshot name, version and avatar. Every portrait accepted by the manifest is also accepted by the session projection.

`WorkbenchExpertBundle` from `@actvero/dsh-experts/workbench` loads local workbench instructions, native Skills, MCP and CLI descriptions. Authors supply `bundle.activate` as their provider’s `activate`; resources cache by workbench version while capabilities register per associated conversation and release with its scope. Native Skills and MCP use the Host's peer instances. This entry does not depend on Main expert records or change ordinary expert selection; both environments may coexist in one conversation. See [local workbench development](../../../actvero/workbench-development.md#expert-bundle) for directories, pinned digests, cancellation and failure rules.

<a id="model-experience"></a>

## Model Experience

### Expert persona and dependencies

#### What the model sees

The Host adds the selected expert name, version, instructions and always-loaded verified skill blocks to its `actvero_expert` system-prompt variable. It exposes scoped MCP capabilities and the local authoring tools `expert_catalog`, `expert_create`, `expert_list`, `expert_get`, `expert_update` and `expert_check`. Expert detail results report avatar presence without returning its encoded image. The native Session projections record the immutable expert selection and scoped connector choices. Required expert connectors stay on; optional connectors can be disabled for this conversation.

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
