# Single-expert ZIP format

English | [中文](expert-package.zh.md)

## Package files

This reference defines `actvero-expert` schema version 1 for one local expert. Import uses Electron’s native file picker; archive bytes, paths and staging tokens belong to Main. Export uses the native save dialog. No package command runs during preview or import, and import does not upload content to the platform.

```text
package.json
expert.json
dependencies.json
skills/<key>/SKILL.md
skills/<key>/references/...
connectors/<key>.json
```

`package.json` contains `format: "actvero-expert"`, `schemaVersion: 1` and `files: [{ path, size, sha256 }]`. The file list covers every file except `package.json` itself. Each SHA-256 is the lower-case hexadecimal digest of the original bytes. Unlisted payload, duplicate normalized paths, absolute paths, traversal, symlinks and checksum mismatches reject the archive.

`expert.json` is the strict ExpertManifest v1 accepted by the existing expert manager. Each dependency requirement has a stable key, label and required flag; skills also specify `always` or `on_demand` loading. The imported expert receives a new local identifier unless the same manifest and resolved bindings already exist.

`dependencies.json` contains `schemaVersion: 1`, `skills` and `connectors` arrays. Each entry has the matching requirement `key` and `source: "local"` or `"platform"`. Local entries use `path`: a skill directory under `skills/`, or one JSON template under `connectors/`. A skill directory contains exactly one standard `SKILL.md` and reuses the single-skill validator. Platform entries have no embedded path: they contain `platform`, `id` and `sha256`; a skill also contains `versionId`. A platform MCP digest identifies its saved capability inventory, not a platform release identifier.

Desktop-managed FreeCAD MCP is an exception: `expert.json` may declare `freecad-mcp` as a required connector without putting a local launch command or credentials in `dependencies.json`. When importing an expert that explicitly requires it, the desktop client restores and registers the managed connector from the installed FreeCAD design environment, then binds it to the expert. The ZIP does not contain FreeCAD, a Python runtime, desktop permissions, or tokens, and it never executes arbitrary ZIP commands. If the FreeCAD design environment is not installed, import still asks the user to install it first.

## Import and reuse

The preview lists reuse, installation, name conflict and missing authorization outcomes. Same-name local skills reuse only matching complete file content and an enabled installation. Same-name MCP connections reuse only matching portable configuration; name matching is case-insensitive. Different content blocks import without overwriting anything. Required unresolved platform dependencies block import; optional unresolved dependencies stay unbound. Platform reuse requires the same platform address, exact installed skill version or MCP inventory and current authorization.

Commit rechecks the preview, platform and account/organization scope. Missing local skills install through the existing installer. New MCP templates save disabled: configuring credentials and enabling them remains a separate manager action. For desktop first-party connectors, the environment assistant can register and verify the local connection first; import then reuses it by stable dependency key instead of creating a duplicate template. The expert saves last. On failure, rollback removes only newly created dependencies that no saved expert references; cleanup failure is reported for manual inspection. Existing experts and shared dependencies remain.

## Portable MCP templates

Templates contain configuration and empty credential fields, never saved tokens, OAuth sessions, credential values or a device working directory. Export clears environment/header values and preserves their field names and authentication requirement. Import rejects credential-bearing templates. Remote templates use HTTP or SSE URLs without credentials or query strings. Stdio templates permit `npx` or `uvx` with pinned package versions and optional `-y`/`--yes`; arbitrary commands, paths, scripts and launcher arguments require manual configuration outside this format. Saving a template never launches its command or starts OAuth.

## Limits and ownership

The ZIP limit is 20 MiB compressed, 40 MiB expanded, 500 files and 5 MiB per file. Expert metadata JSON is bounded at 700,000 bytes. Each dependency list has at most 32 entries. Three previews may be staged for ten minutes; account changes invalidate them. The archive contains one expert, not a skill distribution entity. Platform expert release export, automatic cloud upload, conflict replacement and dependency migration are outside this format. Existing conversations keep their immutable snapshots and still check current access before using platform dependencies.
