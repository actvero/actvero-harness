# Actvero client workbenches

English | [中文](workbenches.zh.md)

This reference is for Actvero desktop maintainers starting the workbench preview, integrating local business packages, and interpreting installation and runtime results.

The [design note](../.agents/notes/proposed/architecture/2026-11-05-actvero-workbench-runtime.md) records the intended runtime context, optional host capabilities and bundled local experts. It establishes a design direction without claiming that the shared development interfaces are published.

## Launch and navigation

Install locked dependencies, then run `pnpm run actvero:dev`; use `pnpm run actvero:start` with current artifacts. Run `pnpm run actvero:preview:workbenches` for an independent preview. These entries use development data rather than installed-client accounts and conversations. Select Workbenches in the expanded sidebar to open the local catalog. Opening a workbench fills the content area; Business, Split and Conversation switch its layout, and the upper-left control returns home.

## Host and business packages

The [Actvero workbench package](../packages/actvero/workbenches/README.md) provides the local host. The editable creative canvas and asset notes are bundled reference applications, not service-connected generation plugins. Users need not select a folder or create a named project first. Opening AI assistance creates a native conversation; subsequent topics share the current material directory. Durable associations connect business records and conversations without exclusive workbench ownership. Platform authentication context, model catalogs and automatic bundled-expert loading are not integrated.

The home page's DSH compatibility market retains old workbenches and their switching and conversation-ownership rules. See the [source record](third-party/dsh-desktop-workbenches/UPSTREAM.md) for the pinned MIT-licensed source. The public market still reads DSH's catalog; Actvero publishing, organization distribution and review are not connected.

Local business packages register a Host provider and a Client business slot; see the [package reference](../packages/actvero/workbenches/README.md) for interfaces, storage and model tools. Original DSH bundles use `ctx.desktopWorkbenches.register(descriptor, Component)`. Their [bundled upstream guides](third-party/dsh-desktop-workbenches/) are snapshots, not the latest online specification, and do not automatically convert those packages into Actvero business providers.

## Installation and compatibility

The current Profile's Plugin Manager owns package installation. Verify its application outcome, runtime status, switcher entry and actual business UI separately. The baseline cannot directly replace installed packages: the adapter refuses replacement and directs the user to uninstall through plugin management before installing again. It never removes packages automatically. The normal Harness compatibility checks still reject incompatible packages.

npm market archives are downloaded and checked against the catalog's SHA-512 digest, package name and version before local installation. Native approval and compatibility checks remain active.

## Verification

Local-workbench browser acceptance uses the real Desktop Host to check persistence, the native composer, view and topic switching, drafts and reload restoration in light, dark and narrow layouts. Old DSH compatibility acceptance remains independent. A keyless adapter exercises the native model path, checking business instructions, data tools and Session logs.

Use the normal `build:artifacts` and subsequent `build:check` commands. Browser checks do not establish signed-installer or real-account/model acceptance.
