# Local workbench development

English | [中文](workbench-development.zh.md)

## Summary

This tutorial is for workbench developers with an Actvero repository development environment: start from the project checklist template, edit its business view, and build a local archive for the desktop client. No GitHub account, repository URL, or publishing service is required. The template uses this checkout's compiler; run the commands below from the repository root.

## Table of Contents

- [Create and package](#create)
- [Import and verify](#install)
- [Package format](#format)
- [Edit the business view](#business)
- [Limitations](#limits)

<a id="create"></a>

## Create and package

Prepare repository dependencies using the [client development guide](workbenches.md). Creation requires a destination that does not exist, preserving existing files. The second argument is the stable package name; retain it across versions of the same workbench.

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist
pnpm run actvero:workbench pack .artifacts/my-checklist .artifacts/workbenches
pnpm run actvero:workbench check .artifacts/workbenches/local-my-checklist-1.0.0.tgz
```

`create` copies the editable checklist; `pack` compiles Host and Client, generates the bundle patch, and reports the validated `.tgz`, byte count, and SHA-256. Packaging does not modify business sources, install, or publish. A same-named output replaces the previous artifact; a failed build preserves it. Omitting the output directory uses the project's `dist`.

`check` reuses desktop import preflight and checks the format marker, version declarations, nonempty entry files, and duplicate, escaping, or linked paths. It does not execute workbench code or establish business acceptance. Installation also checks compatibility with the current runtime; the development command does not bypass this check.

<a id="install"></a>

## Import and verify

Start the Actvero development client, open Workbenches → My workbenches, choose Import workbench, and select the output. If the result requires a restart, use Harness → Restart Harness. After loading, Project checklist appears in the catalog and sidebar switcher. The built-in example remains available for reference; the independent package's details show the author 本地开发 to distinguish it.

Open the independent package, check an item, return to the manager and reopen it, then reload the client and reopen it to verify saved progress. Check previews, expanded/collapsed sidebar, light/dark themes, and a narrow window. First use creates no conversation and requires no workspace selection. Verify the installation result, catalog entry, switcher, and actual business view separately.

The manager currently rejects repeated installation of the same package. To replace it, uninstall through plugin management before importing the new archive. See [workbench installation limits](workbenches.md) for further constraints. Successful installation does not establish business acceptance.

<a id="format"></a>

## Package format

The format marker is `dsh.actveroWorkbench: 1`. Deliver an npm-compatible `.tgz` with contents under `package/`, at most 8 MiB compressed and 32 MiB unpacked. The npm package name provides stable identity; registration reads the display metadata from `workbench.json` and version from `package.json`.

| File or field | Purpose |
|---|---|
| `package.json.name` / `version` | Stable package name and complete SemVer version; the template registers under the package name |
| `engines.dsh` | Supported DSH runtime range; the template pins the current development baseline |
| `dsh.bundle.patch` | Points to `./cordis.patch.yml`, adding the package to the current Profile |
| `dsh.client` | Declares the Web client and preceding dependencies including `@actvero/dsh-capability-ui` |
| `exports["."]` / `exports["./client"]` | This tool's `./lib/index.js` and `./lib/client.js` outputs |
| `workbench.json` | Source display name, description, category, author, and tags, compiled into the Client |
| `src/client/assets/` | Source previews, bundled through image imports without remote image hosting |
| `src/index.ts` | Host plugin entry; the template has no Host business service |
| `src/client/index.ts` | Registers the card and component through a Cordis effect, removing them on disposal |

The artifact contains only the manifest, generated patch, and compiled `lib`. `repository` may be omitted. React uses the Host's shared instance; CSS Modules and images use the repository client compiler. Do not bundle a second React or Host plugin implementation into business code. Package validation checks format, not code confinement.

<a id="business"></a>

## Edit the business view

Edit card copy in `workbench.json`. Categories use the expert ecosystem's identifiers: `office`, `engineering`, `design`, `content`, `data`, `education`, `lifestyle`, `general`, and `uncategorized`. My workbenches omits category filtering, but packages may carry a category.

Edit the business view in `src/client/Checklist.tsx` and its CSS Module, and maintain bilingual copy in `locales.ts`. Declare preview imports and an optional `iconUrl` in the Client entry; the Host supplies a fallback icon. See the [Client definitions](../packages/actvero/capability-ui/src/contracts.ts) for registration. Business content occupies the main area while the Host retains public navigation and window controls.

The example isolates browser local storage by package name and restores progress after reload. A failed read reports an error and disables changes instead of overwriting unreadable data. This storage belongs to the current client configuration; it provides no project, account, or organization isolation and no backup. Production business data requires its own storage design.

<a id="limits"></a>

## Limitations

This tool is a repository development entry, not a published general SDK. It accepts local `.tgz` packages, with no ZIP import, platform downloads, publishing, automatic updates, authenticated user context, or workbench thread binding. Merely adding expert, MCP, or Skill files does not load them; those capabilities require explicit runtime interfaces.

Packages target Actvero's workbench registration service. Legacy DSH workbenches use another service; changing a marker alone does not establish compatibility. The DSH reference is retained as an [offline snapshot](third-party/dsh-desktop-workbenches/development-guide.zh.md), version 2026-10-27; it is not the current online specification and does not replace these Actvero package rules.
