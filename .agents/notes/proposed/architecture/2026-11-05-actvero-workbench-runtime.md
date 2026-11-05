# Agent Note: Actvero workbench runtime context and local experts

Status: proposed

English | [中文](2026-11-05-actvero-workbench-runtime.zh.md)

## Problem

This note is for developers implementing the Actvero workbench framework and business plugins. It defines host capabilities, author freedom and acceptance for the intended interfaces. The design direction is established; the shared runtime context and bundled-expert interfaces remain unimplemented. This note does not publish those interfaces.

Workbench authors need native Conversation, local experts, user identity and service authorization during ordinary application development. Interfaces, persistence, model sources and tool integrations vary; a prescribed business workflow or mandatory cloud expert publication would constrain local workbenches.

Existing host behavior is documented in [client workbenches](../../../../actvero/workbenches.md); existing expert and platform-model capabilities are documented in the [expert reference](../../../../packages/actvero/experts/README.md) and [model adapter reference](../../../../packages/actvero/model-gateway/README.md). These services supply the implementation foundations.

## Proposal

Provide a workbench runtime context, lifecycle entry and optional host capabilities while authors develop ordinary business applications. Compose the context from existing Cordis services, Host Remotes and Client Slots; do not introduce another Agent executor, login system or plugin manager.

| Host capability | Available to workbench authors |
| --- | --- |
| Identity context | Current user, selected organization and necessary identity information |
| Service authorization | Platform authorization requests, service-specific short-lived credentials or authorized requests |
| Native Conversation | Create, restore and embed conversations with explicitly selected project context |
| Local experts | Register definitions bundled with a workbench or reference existing local experts |
| Optional extensions | Business tools, Skills, MCP, CLI and other host-permitted services |

Authors choose layouts, workflows, persistence, model sources and tool implementations. Platform models, custom services and local programs can be combined as needed. Experts, an asset library, Skills, MCP and CLI are not universal prerequisites; local functions independent of platform authorization can operate independently.

### Local experts and lifecycle

Workbench startup provides an initialization entry that may register or prepare one or more bundled experts. Definitions can ship locally and remain private to the workbench, without platform publication or listing in the global expert market. The host owns registration and disposal to prevent stale or duplicate registrations after reload.

Loading definitions, opening conversations and executing model requests are separate operations. Authors choose triggers, entry points and presentation; the host prescribes neither an assistant button nor a permanent conversation area. Calls may specify a local expert and project context, create or restore the matching conversation, and retain existing expert and Session versioning, persistence and authorization semantics.

### Identity and authorization context

Workbench code may read identity information; the host manages service authorization under the target service's access rules. Long-lived account credentials stay under host management. Workbenches request short-lived authorization for a specific resource or use authorized request interfaces. External services use their supported authentication and cannot assume one login token works everywhere.

The context belongs to the current account and organization. Switching, logout or revocation invalidates old authorization; subsequent calls obtain the applicable context again. The complete runtime context is never automatically sent to a model. Authors explicitly select business information, and model-visible content follows the host's recording mechanism.

## Alternatives considered

- Prescribe one expert, Skill, MCP and CLI combination for every workbench: business requirements vary, so retain optional composition and ordinary application development.
- Let each workbench store login credentials independently: this duplicates identity, organization switching and refresh logic, so reuse host authorization services.
- Require prior platform publication of experts: this obstructs local distribution and internal assistants, so support both bundled definitions and existing local expert references.

## Acceptance criteria

- Ordinary local workbenches can register and run without mandatory expert publication, platform models or a particular tool protocol.
- Startup can prepare bundled experts; reload and removal clean up registrations. Preparing definitions does not implicitly execute a model request.
- Authors choose conversation placement, specify an expert and project context, and create or restore the corresponding conversation correctly.
- Workbenches can read necessary current identity information and call authorized services. Servers still enforce resource permissions; long-lived login credentials never enter workbench pages or project files.
- Account, organization and authorization changes prevent old contexts from serving new requests. Runtime contexts never automatically enter model prompts.
- Asset Library and Creative Studio provide integration cases while retaining their interfaces, business services and optional tool combinations. Live platform and model calls receive separate acceptance.

## Risks

Exposing excessive host internals through the context would increase compatibility maintenance. Public interfaces need versioning and explicit capability availability. Exact API names, types, capability declarations and error protocols remain implementation decisions.

Bundled expert definitions and dependencies can change during updates; restored conversations must honor recorded expert versions and permissions. Mixing identity information, authorization credentials and model context can leak information or cross organization scopes; handle the three separately.
