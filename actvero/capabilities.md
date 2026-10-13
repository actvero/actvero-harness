# Capability integration

English | [中文](capabilities.zh.md)

## Delivered behavior

Experts, Skills and Connectors share the official sidebar manager entry. Existing catalog, category, search, detail, local import and connection flows remain. The official composer Add menu contributes Expert, Skill and Connector commands; each uses the native searchable popup with keyboard navigation, Escape and outside-click dismissal. Connector rows use native per-conversation switches and remain open after toggling. Required expert connectors stay on with a grey disabled switch; optional off choices survive the next activation. The expert picker shows recent summons without a standard-mode or manager row. The composer restores the portrait-and-name pill: hover or keyboard focus exposes removal, and the name reopens the native picker. Removing clears the expert for subsequent requests. The desktop package does not seed a default expert; local experts enter through creation or import. Skill insertion preserves existing attachment references and draft revision checks. Expert invocation from a conversation uses that conversation's workspace; only the manager asks when no workspace is known. Previously prepared dependencies do not reopen preparation merely because an expert is invoked again.

All three catalog lists share a skeleton. Connector refresh retains its previous rows after a transient query failure. Operation outcomes use the native global Toast where connected; field validation and query retry remain on their owning surfaces.

## Runtime ownership

`packages/actvero/capability-ui` owns navigation and shared presentation. `skills`, `connectors` and `experts` own executable domain responsibilities and their native client contributions. Electron Main owns resource issuance, encrypted business connections, local package installation and OAuth callbacks. Renderer bridges expose a fixed set of bounded operations; they never return access or refresh tokens. The Host registers native skill views, system prompts and agent-scoped MCP tools. The official product does not load these modules unless `ACTVERO_DESKTOP=1`.

The `@actvero/dsh-model-gateway` Host plugin registers the native DSH `LlmAdapter` route `actvero-platform`, displayed as `平台模型`. It reads the platform model catalog with an `llm:catalog` token, resolves each selected model to an `llm:<uuid>` token, and sends OpenAI-compatible streaming chat requests through the platform endpoint. Catalog capabilities determine model modalities, context and reasoning options; platform authorization, routing, quota and pricing remain server-owned.

Platform, account and organization changes invalidate runtime ownership. Credentials are not imported from an older application's profile. No production build or runtime code reads sibling repositories.

## Versions and authorization

A platform skill installation verifies its version identifier, SHA-256 digest and safe package paths. Updating the active installation retains immutable version records used by earlier expert locks. Loading a recorded version still checks current authorization and files; an installed copy or an archive does not grant offline execution. Revocation blocks use without deleting local files.

Expert adoption locks the release, exact skill versions and capability references. Native Session projections restore and fork the recorded snapshot. A started conversation is not rewritten when another expert is selected: invocation begins a new conversation in the same workspace. Remote validation uses Skills access contract 2 and Experts access contract 3, including MCP semantic capability checks. An incompatible or revoked dependency fails without falling back to the latest catalog content.

Local MCP supports stdio, Streamable HTTP and SSE through the MCP SDK, including personal OAuth/PKCE refresh and Tools, Prompts, Resources and Resource Templates. Every business call checks the current session policy and personal authorization. Reusing an established connection avoids a redundant initial login prompt; expired or revoked authorization can still require reconnection.

Native `actvero/connectors` events preserve ordinary and expert conversation intent across Host restart and forks. Platform choices are scoped by platform, account and organization; local choices use a local scope. A choice does not grant authorization or globally enable a disabled MCP configuration. Local expert import supports the [single-expert ZIP format](expert-package.md) and legacy JSON. A marketplace and automatic platform upload are not included.

## Verification

The package tests cover dependency validation, snapshot restore, authorization changes and MCP protocol handling. The browser scenarios under `apps/web/tests/actvero-capabilities.e2e.ts` exercise native selectors and retained conversation choices against built Host and client bundles with isolated display fixtures.

Static checks verify documentation, package declarations and generated catalogs. Live platform behavior requires the separate acceptance below.

## Remaining acceptance

Live platform login, a granted catalog download, a real platform-model stream, personal MCP authorization and an end-to-end expert turn still need acceptance against the deployed platform. Browser fixtures and SDK protocol tests do not establish that deployment's compatibility. Installer, signing and publication verification belong to the release workflow.
