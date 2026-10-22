# Configurable desktop builds

English | [中文](README.zh.md)

## Summary

Use one public configuration to build a desktop application with its own name, icon and default platform address. The commands produce compiled sources or an unsigned local package. Signing, notarization, publishing and update feeds require a separate release workflow.

## Table of Contents

- [Configuration](#configuration)
- [Commands](#commands)
- [Installer output](#installer-output)
- [Installed behavior](#installed-behavior)
- [Platform requirements](#platform-requirements)
- [Dev Note](#dev-note)

<a id="configuration"></a>

## Configuration

The default [product.json](../product.json) names the distribution `Actvero Harness`. Its stable application identifier remains `com.actvero.desktop`; the display-name change preserves data paths and system-encryption identity. Copy [product.example.json](../product.example.json) to `actvero/customer.json` and edit the public values for another distribution. Artwork paths resolve relative to the selected JSON file and must remain inside this repository; the build never reads a sibling project.

| Field | Effect |
| --- | --- |
| `product.id` | Output directory and `<id>-desktop://open` return protocol; use a lowercase identifier. |
| `product.applicationId` | Native application identity and installed data directory; use a reverse-domain identifier. |
| `product.displayName` | Application name used in the installer, About/menu/tray, login and sidebar. |
| `product.version` | Installer version; independent of the pinned DSH runtime version. |
| `product.defaultLocale` | Initial native language, `zh-CN` or `en-US`; a saved user preference takes precedence. |
| `branding.icon` | Required square SVG/PNG for the application, Dock and fallback UI logo. |
| `branding.logo` | Optional UI/login logo; defaults to `branding.icon`. |
| `branding.trayIcon` | Optional square SVG/PNG for the Windows tray; defaults to `branding.icon`. |
| `platform.defaultUrl` | Default platform address; remote services require HTTPS, loopback development may use HTTP. |

The default profile uses `app-icon.svg` for the application, Dock and Windows tray: a black mark on a white rounded square. Its separate `branding.logo` uses the transparent `icon.svg` for the sidebar and login pages.

Keep a distribution's `id` and `applicationId` stable across upgrades. Different coinstalled distributions need different identifiers. Do not put credentials, issuer overrides or private account data in the configuration. Local unsigned packages require `updates.enabled=false`; [product preparation](../README.md#build-configuration) owns plugin pins, which do not install the selected third-party plugins.

Private local product configurations and artwork can live under `.actvero-builder/products/<id>/`, with profiles under `.actvero-builder/presets/`; Git ignores that directory. Share these files separately with a build operator. The installer embeds the selected public defaults and artwork, so never put secrets in them.

<a id="commands"></a>

## Commands

Run from the repository root after installing the lockfile dependencies with the supported Node and pnpm versions. Omit `--config` to use the default profile.

```sh
pnpm run actvero:check --config actvero/product.json
pnpm run actvero:build --config actvero/product.json
make package-check TARGET=mac-arm64 CONFIG=actvero/product.json
make package TARGET=mac-arm64 FORMAT=dmg CONFIG=actvero/product.json OUT=dist
```

`actvero:check` validates public defaults, locks and artwork. `actvero:build` compiles the complete desktop and client artifacts. `actvero:package` prepares the target runtime, includes the ACTVERO account/capability modules, verifies runtime integrity and creates the branded package. Each package checks Main imports inside the archive and exercises the packaged Host, Office conversions and skill CLI discovery. Two isolated Hosts must serve their frontends concurrently on distinct default ports and survive independent shutdown and restart. `--dir` produces an unpacked test application; omit it for DMG/ZIP on macOS or an NSIS installer on Windows. Nothing is published or installed by these commands.

Prepared artwork, public metadata and packages are under `apps/desktop/.desktop-build/actvero/products/<id>/<fingerprint>/`; packages are in `artifacts/<platform>-<arch>/` beneath that directory. The fingerprint changes with configuration or artwork bytes. Build one profile at a time: compiled workspace files and target runtime preparation are shared.

`actvero:package --check` validates public inputs, artwork, host/target, format, export destination and the required tar/Windows C++ toolchain; it does not compile or validate a completed installer. After a complete successful preparation, `--skip-prepare` reuses the integrity-recorded target runtime and rebuilds the desktop shell; rebuild without this flag when dependencies or client code change. A stale or missing runtime fails instead of silently fetching another release.

The visual builder and Make use the same local `Build Profile` format. A profile references a base product JSON and stores only public overrides; pass one with `PROFILE=.actvero-builder/presets/name.json make package` or `make package-check`. Explicit Make or CLI values override profile values, and the source product JSON is never rewritten.


### Release baseline checks

The desktop pins the officially published `0.2.1-rc.2` release candidate; it is not a final stable tag. The product installer version is independent of the DSH version. The build entry checks that the version, Git tag and commit in `upstream.lock.json` agree and that all shipped DSH workspaces use that version. Alpha/beta development baselines and mixed versions fail before compilation. Do not relabel the root manifest to bypass plugin compatibility checks.

Use separate worktrees for concurrent chats or tasks and rerun `make package-check` after merging. After dependency or client changes, run a full build without reusing old `lib` files or `--skip-prepare`. A new baseline can first be checked with `pnpm run clean`, which removes generated output only. Verify the archived runtime and actual hover, keyboard and menu interactions in the resulting client.

<a id="installer-output"></a>

## Installer output

Make forwards public values through environment variables without inserting them into shell commands. The same options are available to `pnpm run actvero:package`, including on Windows without Make. Explicit CLI arguments override Make values; brand overrides create a cache configuration and never edit the selected JSON. Profile and CLI artwork paths start at the repository root and support nested directories on every build host; product JSON artwork paths remain relative to that JSON.

| Make parameter | CLI option | Meaning |
| --- | --- | --- |
| `CONFIG` | `--config` | Product JSON; default `actvero/product.json`. |
| `PROFILE` | `--profile` | Local Build Profile; its values provide defaults on top of the selected product JSON. |
| `TARGET` | `--target` | `mac-arm64`, `mac-x64` or `win-x64`; default current Node platform/architecture. |
| `FORMAT` | `--format` | `dmg`, `zip`, `exe` or `all`; default DMG/ZIP for Mac, EXE for Windows. |
| `OUT` | `--out` | Export root; default `dist`, relative to the repository or absolute. |
| `NAME`, `VERSION` | `--name`, `--version` | Display name and exact product version; application identity stays unchanged. |
| `ICON`, `LOGO`, `TRAY_ICON` | `--icon`, `--logo`, `--tray-icon` | Application/Dock, UI/login and Windows tray artwork. |
| `PLATFORM_URL` | `--platform-url` | Default platform address. |
| `DOWNLOAD_BASE_URL` | `--download-base-url` | HTTPS hosting root; URLs append the product/version/target/file path. |
| `RELEASE_DATE` | `--release-date` | Optional real date in `YYYY-MM-DD`; omitted remains unset. |
| `NOTES` | `--notes` | UTF-8 release-notes file, at most 256 KiB; omitted produces empty notes. |
| `MIN_SYSTEM` | `--min-system` | Operator-specified minimum system requirement, subject to compatibility validation. |
| `DIR=1` | `--dir` | Internal unpacked test app; cannot combine with format, output or release metadata. |
| `SKIP_PREPARE=1` | `--skip-prepare` | Reuse a previously verified target runtime. |

After the internal package passes archive/runtime checks, installers are copied to `<OUT>/<product.id>/<product.version>/<TARGET>/`. `release.json` records product/version, build time, optional publication date, notes, unsigned status and each installer's system, architecture, actual file name, byte count and SHA256. `release-info.txt` presents the same fields in Chinese for copying into the platform form; `build-config.json` records the public effective defaults with paths relative to the original configuration. The export refuses an existing destination, including an empty directory; choose a new version or output root. Failed exports remove their staging directory and never replace existing files.

A supplied download root generates planned URLs; the command neither uploads files nor verifies those URLs. Missing URLs, publication dates and minimum requirements remain null; build time is separate from publication date. Recommendations are selected in the platform. The platform currently requires manual entry; emitting JSON does not add a platform import endpoint. Recompute size and SHA256 after any later signing or modification of the installer.

```sh
make package TARGET=mac-arm64 FORMAT=dmg OUT=dist \
  NAME="Actvero Harness" VERSION=0.1.0 ICON=actvero/app-icon.svg \
  LOGO=actvero/icon.svg TRAY_ICON=actvero/app-icon.svg \
  PLATFORM_URL=https://platform.example.com \
  DOWNLOAD_BASE_URL=https://downloads.example.com/desktop
```

Run Windows packaging on the qualified Windows host using the same JSON and `--target win-x64 --format exe --out dist`. Windows ARM with x64 Node may satisfy the process-architecture selection, but its native build tools and complete installer/runtime still require Windows acceptance; native ARM64 Node is rejected for `win-x64`.

<a id="installed-behavior"></a>

## Installed behavior

The platform address stored by the user takes precedence over the build default and survives upgrades. Changing the address follows the normal login flow; the identity service is discovered from that platform. The packaged product name and logo remain authoritative in the login, browser confirmation and sidebar after connecting; public platform branding is used only when no product brand is supplied. Native identity, Dock/tray icon, return protocol and data paths stay build-owned. The default ACTVERO mark is black on light surfaces and white on dark surfaces. SVG UI logos retain their theme rules; the light login artwork panel uses the light variant. Native icons are rasterized separately.

Installed user data lives below Electron's application-data directory in `<applicationId>/`; DSH profiles default to its `dsh/` child. An explicitly configured `DSH_HOME` retains its existing meaning. Account development commands continue using isolated development profiles. Browser return links use the selected distribution's protocol and do not reuse the official app's `dsh` protocol.

<a id="platform-requirements"></a>

System encryption uses the stable `product.applicationId`; `displayName` only changes visible branding. Changing the display name keeps the same keychain namespace. Early ACTVERO development profiles encrypted under the package name or display name require an explicit encrypted migration; the app neither imports the previous desktop’s credentials nor resets unreadable files.

## Platform requirements

Supported targets are `mac-arm64`, `mac-x64` and `win-x64`. macOS targets require macOS; `win-x64` requires a Windows x64 host. Electron packaging can cross-build some applications, but this repository prepares native dependencies and executes target runtime checks. Do not bypass those checks to claim a Windows artifact built on macOS.

Use the same configuration in a Windows CI runner for Windows delivery. A Mac can initiate that CI job; compilation and installer verification occur on Windows. This local implementation is verified on macOS ARM64; a Windows runner owns Windows installation, tray and runtime acceptance.

Follow the [Windows installer tutorial](windows.md) for PowerShell commands, artifact verification and installed-application acceptance.

<a id="dev-note"></a>

## Dev Note

Platform installation, signing and real-account acceptance belong to the release workflow. Repository checks validate source and documentation; they do not replace macOS or Windows installer acceptance.
