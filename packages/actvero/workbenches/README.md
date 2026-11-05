---
description: "Local workbench providers, persistent business material and native AI conversations."
kind: package-reference
---

# Actvero Local Workbenches

English | [中文](README.zh.md)

## Summary

This reference is for client maintainers and business-workbench developers integrating local business interfaces, native conversations and persistent material. For launch commands and user navigation, see [Actvero client workbenches](../../../actvero/workbenches.md).

## Table of Contents

- [Runtime and storage](#runtime-and-storage)
- [Providers and interfaces](#providers-and-interfaces)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Runtime and storage

The host stores business records, favorites and conversation associations in `state.json` under `root`. Writes use a file lock and atomic replacement; updates require the current revision. Conflicts are explicit, and corrupt or unsupported state is never replaced with empty data. Unloading a provider retains material for the same identifier when it loads again. Storage is local; cross-device synchronization is not provided.

Opening a workbench creates default business material without naming a project, selecting a directory or creating a conversation. Users can create projects for separate tasks. The first AI-assistant request creates a native Workspace and Session; subsequent topics share that material directory while retaining separate native conversation logs. A missing directory for previously associated material blocks new topics until the original directory is restored.

`refreshIntervalMs` controls state polling, defaulting to 2500 milliseconds. `maxImportBytes` bounds archive uploads, defaulting to 16 MiB. `examples` enables the two bundled reference providers by default. The examples present creative text, reference imagery and asset notes; they do not invoke image or video generation services.

## Providers and interfaces

A business Host plugin calls `ctx.actveroWorkbenchRuntime.register(provider)` with metadata, initial data, validation and model instructions. Its Client plugin calls `ctx.actveroWorkbenches.register(id, Component)` with the same identifier. Both return disposers owned by the business plugin's Cordis effects. Host and Client entries declare their dependencies separately; installable archives retain the native DSH bundle format and compatibility checks.

Business components receive a project, busy state, save operation and AI-assistant operation. Business content responds to its own container width. The host offers business, split and conversation views using the native Conversation Content Factory. View changes retain the same native composer; topic changes use native draft storage. The native new-conversation shortcut creates another topic for the open workbench. Narrow containers reduce business-card columns and prioritize conversation when the split layout lacks space.

Catalog archive import stages files under `root/imports` before handing them to the native Plugin Manager. Staged files remain available for failure inspection. Successful installation, loading after restart, provider registration and a working interface are separate outcomes. The compatibility market retains old DSH workbenches and their independent conversation ownership rules. Local bundles require no GitHub repository.

## Model Experience

### Local business data tools

#### What the model sees

Only native conversations associated with business material receive workbench instructions and `actvero_workbench_read` and `actvero_workbench_update`. Reading returns complete current business data and its revision. Updating requires a prior read, complete JSON data and that revision. Execution rechecks the conversation association and loaded provider, and the provider validates the data. Ordinary conversations do not advertise these tools. Native model requests and tool results remain in Session logs.

#### Token effect

Provider instructions and two tool definitions add context to an associated conversation. Reading or updating returns the full business record, so result tokens grow with its content. Opening a workbench or switching views sends no model request.

#### KV Cache effect

The provider and project name remain stable within the same business material. Changing projects or provider instructions changes that prompt section; business edits appear in tool results rather than changing the system prefix.



## Known Limitations and Deferred Work

The business tools only read and update local data; they submit no media-generation or publishing jobs. Native model calls follow the configured model billing. Organization authentication, platform model catalogs and automatic bundled-expert loading are not integrated into business runtime context. Real model calls require an available client model. Tests use a mock adapter through the native execution path, not real-account acceptance.

- This preview has no platform authentication context, media-generation integration or automatic workbench-expert activation. Native Windows window controls and archive installation of a production business provider need separate acceptance.

<a id="dev-note"></a>

### Dev Note

Run the package tests and the local-workbench browser case after building the Host and Client. Real-account generation, organization authorization and native Windows window behavior require separate acceptance.
