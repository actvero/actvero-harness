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

`expert.json` uses ExpertManifest v1. Its `id` is the stable package identity and `version` is a three-part numeric version; later releases retain the same `id`. First import assigns a local identifier, subsequent updates preserve it, and export preserves the source identity. Dependencies declare a stable key, label and required flag; skills also declare `always` or `on_demand` loading.

`dependencies.json` contains `schemaVersion: 1`, `skills` and `connectors` arrays. Each entry has the matching requirement `key` and `source: "local"` or `"platform"`. Local entries use `path`: a skill directory under `skills/`, or one JSON template under `connectors/`. A skill directory contains exactly one standard `SKILL.md` and reuses the single-skill validator. Platform entries have no embedded path: they contain `platform`, `id` and `sha256`; a skill also contains `versionId`. A platform MCP digest identifies its saved capability inventory, not a platform release identifier.

Desktop-managed FreeCAD MCP is an exception: `expert.json` may declare `freecad-mcp` as a required connector without putting a local launch command or credentials in `dependencies.json`. When importing an expert that explicitly requires it, the desktop client restores and registers the managed connector from the installed FreeCAD design environment, then binds it to the expert. The ZIP does not contain FreeCAD, a Python runtime, desktop permissions, or tokens, and it never executes arbitrary ZIP commands. If the FreeCAD design environment is not installed, import still asks the user to install it first.

## Import and reuse

The preview shows current and incoming versions and each dependency’s reuse, install, update, conflict or authorization state. Identical reimports add no expert or version. Older versions and different content under the same version number are rejected. A higher version with the same source identity updates the local expert. For legacy records without source record, a unique same-name expert can be associated after the preview explicitly identifies this decision; ambiguous names require renaming first. Local expert edits, modified skill files, unrelated name collisions and changed skills shared by other experts block replacement. Required platform dependencies still need the same platform, exact version or inventory digest and current authorization; unresolved optional dependencies remain unbound.

Commit rechecks the preview, expert revision and account/organization scope. Changed local skills retain original files beside their new version so existing conversations can read their pins; disabling or uninstalling still applies to every version. A changed MCP template creates a separate version-labelled disabled configuration, preserving the original connection and credentials. The user reviews, authorizes and enables it in the manager. First-party connectors are reused by stable key. The expert and source record baseline save atomically last. Failure restores the skill’s previous current version and removes newly created dependencies unreferenced by experts; cleanup failures are reported. Updated local skill indexes require this desktop version or newer.

## Portable MCP templates

Templates contain configuration and empty credential fields, never saved tokens, OAuth sessions, credential values or a device working directory. Export clears environment/header values and preserves their field names and authentication requirement. Import rejects credential-bearing templates. Remote templates use HTTP or SSE URLs without credentials or query strings. Stdio templates permit `npx` or `uvx` with pinned package versions and optional `-y`/`--yes`; arbitrary commands, paths, scripts and launcher arguments require manual configuration outside this format. Saving a template never launches its command or starts OAuth.

## Limits and ownership

The ZIP limit is 20 MiB compressed, 40 MiB expanded, 500 files and 5 MiB per file. Expert metadata JSON is bounded at 700,000 bytes. Each dependency list has at most 32 entries. Three previews may be staged for ten minutes; account changes invalidate them. The archive contains one expert, not a skill distribution entity. Platform expert release export, automatic cloud upload, automatic conflict replacement and dependency deletion are outside this format. Existing conversations keep their immutable snapshots and still check current access before using platform dependencies.
