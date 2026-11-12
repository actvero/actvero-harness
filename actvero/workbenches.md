# Actvero client workbenches

English | [中文](workbenches.zh.md)

This reference is for Actvero desktop maintainers starting the workbench preview, integrating local business packages, and interpreting installation and runtime results.

The [design note](../.agents/notes/proposed/architecture/2026-11-05-actvero-workbench-runtime.md) records the intended runtime context, optional host capabilities and bundled local experts. It establishes a design direction without claiming that the shared development interfaces are published.

See [local workbench development](workbench-development.md) to generate an independent archive from the editable template.

## Launch and navigation

Install locked dependencies, then run `pnpm run actvero:dev`. Use `pnpm run actvero:start` with current artifacts. Both commands use isolated development data.

Workbenches opens Actvero’s My workbenches page. The list starts empty. Import an Actvero workbench package from this device or use a release from the platform catalog. Category filters appear only in the platform catalog and do not filter My workbenches. Imported cards show the installed version and runtime status and remain visible while disabled. If installation requires a restart, choose Harness → Restart Harness.

Click the Workbenches title on the sidebar to open management; click the adjacent name to switch directly between loaded entries in My workbenches. The switcher appears when a workbench is loaded. The menu marks the current selection and shows the full text of long names on hover. Returning to management or reloading preserves the last selection without forcing startup navigation to the business page. Unloaded or unregistered providers do not appear in the menu.

Opening a workbench gives its component the main area without creating a conversation or asking for a directory. AI-enabled workbenches offer Ask AI and New workbench conversation. Selecting Add → Workbenches in a native conversation adds a composer badge and header actions for floating or full business views. Collapsing preserves the association; detaching removes that conversation’s workbench capabilities. Reopening an existing conversation restores its selection. See [local development](workbench-development.md#native-ai) for runtime and data rules.

In Platform workbenches, select Use on a release shared with you to download and install it. The workbench opens after it loads and appears in My workbenches. Open reuses the installed version. When a newer release is published, choose Update and open or use the action menu to open the installed release while it remains authorized. If an installation or update requires a restart, restart Harness before opening it. When the release is withdrawn or access is revoked, the installed workbench can be uninstalled and its opening check reports that it is unavailable.

My workbenches shows the source and runtime state of each added workbench. Card previews and detail thumbnails scroll horizontally without visible scrollbars or image counts; card edge arrows appear on hover or keyboard focus and remain visible on touch devices. Selecting the card opens details; selecting a thumbnail starts at that preview. Details place images on the left and the description, source, version, optional author and Open action on the right, stacking vertically in narrow windows. Previews and thumbnails have visible borders, with a highlight on the selected image. Detail thumbnails align to the left; clicking a thumbnail or pressing an arrow key switches the image, without previous/next buttons. Single images hide thumbnails; clicking the main image enlarges it. Previews are provided by the workbench, not live project views.

Actvero local packages use npm-packed `.tgz` files. The manifest declares `dsh.actveroWorkbench: 1`, a bundle patch, and a client entry that depends on `@actvero/dsh-capability-ui`. The client plugin registers its card and business component through `ctx.effect(() => ctx.actveroWorkbenches.register(descriptor, Component))`. The active profile’s plugin manager installs the package, and the workbench page opens the registered component.

## Host and business packages

Standard layouts combine a business panel and the native Conversation. Full-page business layouts own their first-use entry and place the host's Conversation node when AI help is requested. Native slots and a Factory preserve the existing Conversation implementation. Sidebar projections filter display only; the original Session and Workspace Controllers remain complete.

## Installation and compatibility

The current Profile's Plugin Manager owns package installation and checks package compatibility. Verify the installation result, runtime status, switcher entry and business UI. See [local development](workbench-development.md#install) for same-name updates, enabling, disabling, removal and data retention.

## Verification

`apps/web/tests/actvero-workbench-manager.e2e.ts` uses the Desktop Host and temporary workbench packages to check local and organization workbench installation, updates, switching and opening a workbench. Use `build:artifacts` followed by `build:check`. Browser checks do not establish signed-installer or live-account/model acceptance.
