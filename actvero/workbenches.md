# Actvero client workbenches

English | [中文](workbenches.zh.md)

This reference is for Actvero desktop maintainers starting the workbench preview, integrating local business packages, and interpreting installation and runtime results.

## Launch and navigation

Install locked dependencies, then run `pnpm run actvero:dev`; use `pnpm run actvero:start` with current artifacts. These commands use isolated development data. Expand the sidebar and select Workbenches to open its home; the adjacent name switches between ordinary sessions and loaded workbenches. Installed shows local packages and their observed runtime status.

## Host and business packages

The host uses DataElement's MIT-licensed DSH Desktop source; see the [source record](third-party/dsh-desktop-workbenches/UPSTREAM.md). It retains the market, favorites, switching, installation status and native Conversation composition. The catalog remains DSH's public catalog. Actvero organization distribution, publishing and review are not connected.

A business workbench is an independent DSH bundle. Its client registers through `ctx.desktopWorkbenches.register(descriptor, Component)` and owns the disposer through a Cordis effect. Local packages may omit repository metadata; package names establish stable local identity. The [bundled upstream guides](third-party/dsh-desktop-workbenches/) are source snapshots, not a claim about the latest online specification.

Standard layouts combine a business panel and the native Conversation. Full-page business layouts own their first-use entry and place the host's Conversation node when AI help is requested. Native slots and a Factory preserve the existing Conversation implementation. Sidebar projections filter display only; the original Session and Workspace Controllers remain complete.

## Installation and compatibility

The current Profile's Plugin Manager owns package installation. Verify its application outcome, runtime status, switcher entry and actual business UI separately. The baseline cannot directly replace installed packages: the adapter refuses replacement and directs the user to uninstall through plugin management before installing again. It never removes packages automatically. The normal Harness compatibility checks still reject incompatible packages.

npm market archives are downloaded and checked against the catalog's SHA-512 digest, package name and version before local installation. Native approval and compatibility checks remain active.

## Verification

`apps/web/tests/actvero-workbenches.e2e.ts` composes the real Desktop Host with a temporary local provider to exercise Installed, switching, first-use behavior, native Conversation, reload, light/dark themes and narrow layouts. The fixture is not a shipped business workbench. Workspace navigation tests cover ownership, blank reuse and reversible filters. Use the normal `build:artifacts` and subsequent `build:check` commands. Browser checks do not establish signed-installer or live-account/model acceptance.
