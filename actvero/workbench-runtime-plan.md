# Workbench runtime implementation plan

English | [中文](workbench-runtime-plan.zh.md)

This plan is for engineers implementing the workbench host, developer tooling, and expert integration. Use it to sequence local runtime work and define acceptance criteria for each phase. Status: Part 1 runtime directories, optional storage and AI enablement, and Part 2 bundled expert loading are implemented and verified through an isolated client, real Desktop Host and focused regressions; Windows runtime acceptance remains pending. Parts 3–6 remain planned targets; see the [workbench development guide](workbench-development.md) for the current package format and interfaces.

## Summary

Implement six parts: runtime and data directories; AI and bundled experts; presentation controls and Agent tools; identity and platform access; developer tooling; and a development Skill with end-to-end acceptance. Prioritize the first two parts, reuse existing package management and UI, and defer platform publishing and distribution.

## Contents

- [Design scope](#scope)
- [Existing foundation](#baseline)
- [Part 1: Runtime and data directories](#runtime)
- [Part 2: AI and bundled experts](#ai)
- [Part 3: Presentation controls and Agent tools](#presentation)
- [Part 4: Identity and platform access](#identity)
- [Part 5: Developer tooling](#tooling)
- [Part 6: Development Skill and end-to-end acceptance](#skill)
- [Delivery sequence](#delivery)

<a id="scope"></a>

## Design scope

The host provides a stable runtime and optional capabilities. Workbench authors choose the UI, business workflow, data structures, storage technology, and how AI operates on business data. A workbench without AI must open, operate, and save without first creating a conversation or choosing a workspace.

| Owner | Responsibilities |
| --- | --- |
| Host | Installation and versions, runtime directories, presentation, native conversations, permission enforcement, public identity context, and platform request access |
| Workbench | Business UI, storage choices, project organization, data migration, business operations, and state refresh |
| Bundled expert | Instructions, Skills, MCP and CLI usage, and organization of the current business context |
| User | Workbench selection, access authorization, presentation preferences, and whether to use AI |

This scope excludes a platform workbench marketplace, submission review, remote distribution, automatic updates, and cross-device business data synchronization. Authors are not required to use a host-defined project table, database, or business operation protocol.

<a id="baseline"></a>

## Existing foundation

The following baseline comes from source and developer-guide review; it does not replace runtime acceptance for each phase.

| Existing capability | Follow-up |
| --- | --- |
| Local scaffolding, packing, validation, import, and version management | Reuse and extend compatibility validation for new interfaces |
| Management page, business page, AI popup, and workbench preview in conversations | Reuse and expose consistent presentation controls |
| Native session binding, expert instructions, and explicit business tools | Extend to optional AI and complete bundled-expert loading |
| Stable instances, custom business directories, and optional JSON adapter | Available for subsequent expert and tool integration |
| Public account information | Add controlled platform request access |

The main implementation is in the [workbench capability package](../packages/actvero/capability-ui/README.md). The Host supports custom storage and an optional `storage` adapter while retaining legacy `initial()`, `reduce()`, and `actionHelp` registrations. Only the JSON adapter manages business state; custom-storage authors organize their own projects. `environment()` exposes stable data directories without a session, preserving existing instances, directories and association events.

<a id="runtime"></a>

## Part 1: Runtime and data directories

Goal: authors receive a stable local storage location and choose what to store, how to store it, and whether to organize multiple business projects within it.

### Deliverables

- Provide one runtime context containing the workbench identifier, installed version, read-only resources directory, writable data root, and optional session association. This context is available without AI.
- The host manages and consistently resolves the data root. Business data does not belong in the plugin installation directory, process working directory, or temporary extraction directory; upgrades and reloads preserve its location.
- Authors may use JSON, SQLite, files, or remote services. The host does not maintain another authoritative copy of business state.
- Keep the current JSON state and action implementation as an optional adapter. Checklist-style workbenches can retain it; other workbenches need not implement empty `initial/reduce` methods.
- Preserve existing instance identifiers, directories, and conversation associations. Introduce the new interface through compatibility adapters; any required persisted-format migration needs its own migration plan and upgrade guide.
- Uninstall retains business directories by default; data deletion is a separate action. Rolling back installed code does not promise an automatic rollback of business data formats.

One data root does not imply one business project. Authors can create multiple projects within it and decide which project each conversation uses; the host stores only necessary association identifiers and does not define the project schema. Session working directories, business data directories, and file access permissions are separate concerns: obtaining a path does not automatically grant AI arbitrary file access.

### Acceptance criteria

A workbench without AI runs independently; two workbenches do not overwrite each other's data; the existing checklist preserves data and linked conversations after upgrade; a custom file-storage example survives restart without writing host-managed generic JSON state. Authors own concurrent business writes, transactions, and business data migration, and framework documentation states that responsibility.

<a id="ai"></a>

## Part 2: AI and bundled experts

Goal: authors enable native AI conversations with minimal configuration; bundled experts determine how AI understands and operates on the workbench.

### Deliverables

- Declare whether AI is enabled and optionally identify an expert entry. Ordinary AI conversations remain available without an expert bundle; experts need no separate model binding and use the session model by default.
- Reuse the existing expert, Skill, MCP, and command-execution systems. Distinguish bundled resources, installed dependencies, and dependencies requiring installation instead of introducing another execution engine.
- Load expert instructions and declared capabilities into associated sessions, with the current workbench, data directory, and author-provided business context. Do not send the whole business directory to the model by default.
- Authors can use direct business tools, MCP, Skills with CLI commands, or file operations. The framework does not force operations through a generic JSON action; the UI reads updated data through author-defined refresh mechanisms.
- Resolve and cache dependencies by package version; record the expert version used by a session. Expose version changes, missing dependencies, startup failures, and insufficient authorization clearly; canceled loading leaves no session tools behind.
- Release associated capabilities when switching workbenches, detaching, or ending sessions. Retries and repeated opens do not duplicate tool registrations or leak old workbench context into other sessions.
- Record expert instructions, business context, and tool results that reach model requests through the existing session-log mechanism so requests remain traceable.

A bundled expert need not occupy the ordinary expert-selection chip, but its instructions, capabilities, and permissions remain inspectable. Opening a popup does not send a message or execute a business operation; the host continues to manage model credentials and permissions.

### Acceptance criteria

Verify that both explicit business tools and Skills with CLI commands can modify the authoritative business data and refresh the UI. Verify loading and disposal of a bundled MCP integration, including missing dependencies, offline caches, canceled loading, and session switching. Workbenches without AI do not start these dependencies; unrelated conversations do not receive each other's tools or project context.

The local implementation connects `WorkbenchProvider.activate` with `WorkbenchExpertBundle`. Packaged resources resolve by workbench version; installed Skills pin digests and recheck native authorization. Each conversation registers its own Skill/MCP capabilities and awaits release on detachment, provider removal and native conversation disposal. A real Host verifies direct tools, Skill/CLI and MCP writing the same file with recorded tool results. Platform dependency references, automatic dependency installation and equivalent Windows native-shell acceptance remain separate work.

<a id="presentation"></a>

## Part 3: Presentation controls and Agent tools

Goal: users and Agents can open workbenches, choose presentation modes, and resume existing work without recreating conversations or data.

### Deliverables

- Unify the existing business view, conversation view, floating workbench preview, and AI popup behind presentation interfaces available to authors.
- Allow an initial layout preference: retain the sidebar or focus on business content. Users can change and remember it. Sidebar visibility is separate from operating-system fullscreen, and leaving the workbench restores an appropriate host layout.
- Store AI popup and workbench-preview visibility and position preferences separately. Use declared defaults initially, then prioritize user choices. Collapsing a view does not detach the workbench.
- Creating or switching linked conversations preserves the corresponding workbench and author-selected business context. Opening a business page does not force session creation.
- Add resident Agent capabilities to list available workbenches, open one, inspect current state, and change presentation. Share the UI operation entry points instead of duplicating navigation and association logic.
- Return confirmed presentation state. A disconnected frontend, loading failure, or pending request must not report success; repeated requests reuse existing instances and views.

### Acceptance criteria

Verify entry, exit, sidebar restoration, popup collapse, position persistence, and linked-session switching on macOS and Windows. After an Agent opens a workbench, returned state matches the UI. Narrow windows retain public navigation, previews do not block essential controls, and presentation changes preserve business context.

<a id="identity"></a>

## Part 4: Identity and platform access

Goal: workbenches can use the current login identity to request authorized platform services while local business features remain independently usable.

### Deliverables

- Expose public user, organization, platform-environment, and authorized-capability information consistently. Represent signed-out and unauthorized states explicitly without returning long-lived credentials.
- Provide a platform request channel with authorization managed by Electron Main. Integrate one real service first, such as listing image or video models available to the current user.
- Limit platform access by workbench declarations and user authorization. Authors integrate third-party services themselves; host login credentials are never forwarded to arbitrary destinations.
- Clear or re-resolve related requests and caches after sign-out or organization/platform changes. Authors decide whether business data is partitioned by account; the framework does not silently relocate local files.

### Acceptance criteria

Local features work while signed out or offline; protected services report missing authorization clearly; organization switches cannot reuse resource authorization from the previous organization; business frontends, model context, and logs contain no long-lived tokens. This phase excludes platform workbench publishing.

<a id="tooling"></a>

## Part 5: Developer tooling

Goal: engineers and users working with an Agent can create, debug, pack, and install their workbenches from consistent entry points.

### Deliverables

- Extend the existing `create`, `pack`, and `check` tools rather than adding duplicate commands. Provide minimal templates for an ordinary business UI and a UI with AI and an expert.
- Add a clear development entry in management, connecting the guide, templates, and local import. Creation requires neither a GitHub account nor a repository.
- Define the minimum package: metadata, a UI entry, and resources; add Host services, an expert bundle, and dependency declarations only when needed. AI, cloud services, and generic JSON storage are optional.
- Provide local development previews, loading errors, dependency status, and package validation results. Document package format, host interface version, and business data format version separately.
- Validate paths, versions, entries, resources, and dependency completeness. Retain the current archive formats; decide ZIP support separately based on import needs rather than making it a prerequisite.

### Acceptance criteria

An engineer can follow the guide from an empty directory to generate both templates, build, validate, import, and load them without editing host source. Missing entries, incompatible dependencies, and malformed packages produce actionable errors; failed installations preserve the existing version and business data.

<a id="skill"></a>

## Part 6: Development Skill and end-to-end acceptance

Goal: consolidate implemented interfaces, development workflows, and self-checks into a reusable workbench-development Skill.

### Deliverables

- Keep the developer guide as the authoritative interface reference. The Skill links to it and the templates, guiding requirements confirmation, storage choice, AI configuration, development, validation, installation, and acceptance without duplicating another interface manual.
- The Skill creates business code only after requirements are clear, lets authors choose frontend technology, storage, and tools, and verifies models, connectivity, dependency installation, and permissions.
- Cover the complete workflow with a local custom-storage example and a bundled-expert example. Reuse the existing checklist to verify upgrade compatibility.
- Record acceptance for no session, existing sessions, multiple business contexts, offline use, restart, updates, disablement, and data retention after uninstall. Distinguish static validation, actual loading, and actual AI operations.

### Acceptance criteria

In a clean isolated development environment, complete workbench development and installation using only the Skill and guide. Ordinary business features work without AI, AI modifies data through expert-selected tools, and resumed conversations resolve the correct business context. Checks not actually executed are explicitly marked unverified.

<a id="delivery"></a>

## Delivery sequence

| Order | Deliverable | Prerequisites |
| --- | --- | --- |
| 1 | Ordinary workbenches run reliably with custom storage | Existing package management |
| 2 | Optional AI and complete expert dependencies work | Runtime context from Part 1 |
| 3 | Users and Agents control presentation consistently | Session and context interfaces from Parts 1–2 |
| 4 | The current account can request authorized platform services | Part 1 context and existing login infrastructure |
| 5 | Templates, debugging, and package checks form a standard entry | Stable interfaces from Parts 1–4 |
| 6 | Development Skill and complete acceptance workflow | Working tooling and reference examples |

Each part updates the developer guide, affected templates, and relevant checks as it ships. Part 5 consolidates the developer experience; Part 6 finalizes the Skill. Completing Parts 1–2 validates the core goal: authors freely implement business logic and storage, opt into host AI capabilities, and operate their workbench through their own experts and tools.
