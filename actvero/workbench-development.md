# Local workbench development

English | [中文](workbench-development.zh.md)

## Summary

This tutorial is for workbench developers with an Actvero repository development environment: start from the project checklist template, edit its business view, and build a local archive for the desktop client. No GitHub account, repository URL, or publishing service is required. The template uses this checkout's compiler; run the commands below from the repository root.

## Table of Contents

- [Create and package](#create)
- [Import and verify](#install)
- [Package format](#format)
- [Edit the business view](#business)
- [Native AI and shared data](#native-ai)
- [Organization runtime configuration](#runtime-config)
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

To update, retain the package name, increase `package.json.version`, and rebuild. Select the archive through the card's More → Update version action or import it directly; confirmation shows the installed and incoming versions. Repeated versions, downgrades, mismatched names, and incompatible runtimes are refused. A successful replacement shows Restart required; after restarting Harness, check Loaded, the version, and business content. Independently stored data is retained; business schema migrations belong to the workbench.

The card's More menu offers disable, enable, and uninstall. Disabling retains the package in My workbenches across restarts; only loaded workbenches enter the sidebar switcher. Uninstall requires confirmation and retains independently stored data; importing the same package again restores the example checklist. On installation or update failure, inspect diagnostics and verify the inventory. Successful installation does not establish business acceptance.

<a id="format"></a>

## Package format

The format marker is `dsh.actveroWorkbench: 1`. Deliver an npm-compatible `.tgz` with contents under `package/`, at most 8 MiB compressed and 32 MiB unpacked. The npm package name provides stable identity; registration reads the display metadata from `workbench.json` and version from `package.json`.

| File or field | Purpose |
|---|---|
| `package.json.name` / `version` | Stable package name and complete SemVer version; the template registers under the package name |
| `engines.dsh` | Supported DSH runtime range; the template pins the current development baseline |
| `dsh.bundle.patch` | Points to `./cordis.patch.yml`, adding the package to the current Profile |
| `dsh.client` | Declares the Web client and preceding dependencies including `@actvero/dsh-capability-ui` |
| `dsh.actveroWorkbenchConfig` | Optional runtime configuration fields for organization administrators |
| `dsh.actveroWorkbenchIcon` | Optional catalog icon path such as `./assets/icon.webp`. Use a static PNG, JPEG or WebP up to 64 KiB and 512 × 512 pixels |
| `dsh.actveroWorkbenchPreviews` | Optional ordered list of up to 3 package paths such as `./assets/cover.webp`. Each static PNG, JPEG or WebP must fit within 128 KiB and 2048 × 2048 pixels |
| `exports["."]` / `exports["./client"]` | This tool's `./lib/index.js` and `./lib/client.js` outputs |
| `exports["./locale/*.json"]` | Generated name and description metadata remains available before the workbench loads |
| `workbench.json` | Source display name, description, category, author, and tags, compiled into the Client |
| `src/client/assets/` | Source previews, bundled through image imports without remote image hosting |
| `src/index.ts` | Host plugin entry; the template has no Host business service |
| `src/client/index.ts` | Registers the card and component through a Cordis effect, removing them on disposal |

The artifact contains the manifest, generated patch, display `locale`, and compiled `lib`. `repository` may be omitted. React uses the Host's shared instance; CSS Modules and images use the repository client compiler. Do not bundle a second React or Host plugin implementation into business code. Package validation checks format, not code confinement.

<a id="business"></a>

## Edit the business view

Edit card copy in `workbench.json`. Categories use the expert ecosystem's identifiers: `office`, `engineering`, `design`, `content`, `data`, `education`, `lifestyle`, `general`, and `uncategorized`. My workbenches omits category filtering, but packages may carry a category.

Edit the business view in `src/client/Checklist.tsx` and its CSS Module, and maintain bilingual copy in `locales.ts`. Declare preview imports and an optional `iconUrl` in the Client entry; the Host supplies a fallback icon. See the [Client definitions](../packages/actvero/capability-ui/src/contracts.ts) for registration. Business content occupies the main area while the Host retains public navigation and window controls. Use the same images for Client registration and catalog declarations to keep the cards consistent. Copy the declared files into the source package’s `assets/` directory before packing.

The example isolates browser local storage by package name and restores progress after reload. A failed read reports an error and disables changes instead of overwriting unreadable data. This storage belongs to the current client configuration; it provides no project, account, or organization isolation and no backup. Production business data requires its own storage design.

<a id="native-ai"></a>

## Native AI and shared data

The basic template registers a business UI only. To support native conversations, inject `actveroWorkbenchRuntime` in the Host entry and register a provider with the same identifier as the Client through `ctx.effect(() => ctx.actveroWorkbenchRuntime.register(provider))`. Supply initial JSON, a business reducer and model-visible action documentation. An optional local expert contains a name, version and instructions; it uses the conversation model without separate configuration. An optional preparation function can block binding or a later request on failure; it must not inject unrecorded model context.

Components receive `workbench` context with the business instance, associated conversation, native resource address, conversation opener, business action and public account lookup. `account()` returns null while logged out and public user/organization identifiers and names while logged in. Platform authorization proxying is not connected; those fields are not credentials. `conversation()` creates or resumes the current associated conversation on demand, while `action()` saves against the latest revision. Components read through native `useResource` and adapt to their own container width in full and floating views.

Each Host workbench currently has one default business instance shared by linked conversations. The global New conversation does not inherit it; New workbench conversation links the same instance. Reopening a conversation restores its association and expert version from the log. Collapsing does not detach, and detaching does not delete the checklist. The Host manages instance files beneath its configured directory; new linked conversations create or reuse a workspace named after the workbench at that directory without a folder picker. Existing conversations keep their directory.

See the runnable [built-in checklist provider](../packages/actvero/capability-ui/src/checklist.ts) and [Client](../packages/actvero/capability-ui/src/client/workbenches/Example.tsx). Verify first use without a conversation, manual and tool edits to one checklist, concurrent conflicts, reopening conversations, detachment, floating views and narrow windows. Installation and UI acceptance do not replace real-model or organization-service verification.

<a id="runtime-config"></a>

## Organization runtime configuration

For organization parameters such as service URLs, declare `dsh.actveroWorkbenchConfig` in the archive's `package.json`. Each release can declare up to 32 fields with distinct keys. Package new or changed declarations in a new workbench version.

| Field | Format |
|---|---|
| `key` | Starts with an uppercase letter, followed by uppercase letters, digits, or underscores. Maximum 64 characters |
| `label` | Required label for administrators, up to 80 characters |
| `kind` | `text` or `url`, with `text` as the default. URLs use HTTP or HTTPS |
| `required` | Boolean, defaults to `false` |
| `description` | Optional guidance for administrators, up to 240 characters |
| `default` | Optional non-secret value, up to 2048 characters, matching the field kind |

For example, declare `{"key":"CERTIFICATE_API_URL","label":"Certificate service URL","kind":"url","required":true}`. After uploading a package, the administrator enters values under Runtime configuration in the workbench details. Keep keys stable to reuse organization values across updates. Client components call `await workbench.config()` to read fields allowed for the running version. Organization value changes take effect without repackaging. Reads require desktop sign-in and release authorization. On failure, tell the user to sign in, retry or contact their administrator. Use the host credentials service for API keys and other credentials.

<a id="limits"></a>

## Limitations

The development tool creates, builds, and validates local `.tgz` archives in this repository. See the [client workbench reference](workbenches.md) for organization publishing and installation. Workbenches own authentication for their business requests. Merely adding expert, MCP or Skill files does not load them; Host providers explicitly declare bundled instructions and business actions.

Actvero workbench packages register through `ctx.actveroWorkbenches`. For a package that uses `ctx.desktopWorkbenches`, follow the [workbench migration guide](../docs/upgrade-guide/v0.2.1-rc.3/actvero-dsh-workbench-removal/guide.md).
