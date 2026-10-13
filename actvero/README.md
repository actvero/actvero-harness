# ACTVERO product development

English | [中文](README.zh.md)

## Account development

Install dependencies from the lockfile, then run the native ACTVERO account flow against the platform service:

```sh
pnpm install --frozen-lockfile
ACTVERO_PLATFORM_URL=http://127.0.0.1:5194 pnpm run actvero:dev
```

After a successful build, `pnpm run actvero:start` reuses the artifacts. Runtime address overrides take precedence over the build default; only the platform address is editable, and issuer discovery follows the selected service. Credentials and PKCE proofs stay in encrypted Main storage. One eligible organization is selected automatically; multiple organizations require a selection, which the server retains for the device session. Startup asks the user to confirm the restored account before entering the workspace. A new browser login shows the verified account with Continue and Switch account choices in the browser; confirmation and organization validation then enter the workspace. Confirmed sign-out returns to login; local entry requires another explicit choice.

The account launcher contains Settings, Personal center and Sign out without menu icons or repeated identity headings. Account & quota in Settings shows separate point windows with remaining bars. Public platform branding is shared across organizations. The [account package](../packages/client/actvero-account/README.md) owns the UI and bridge details; [account recovery](account-recovery.md) owns the persistence and acceptance reference.

Account development uses `apps/desktop/.desktop-build/actvero-account-baseline/{home,electron-user-data}` and debug ports 19429, 19422 and 19430. It does not read old ACTVERO profiles or replace an installed application. Exit the existing account development instance before restarting with rebuilt artifacts.

## Official baseline

```sh
pnpm run actvero:dev:baseline
pnpm run actvero:start:baseline
```

These commands retain the official account UI and use separate `actvero-baseline` directories and ports 19329, 19322 and 19330. Baseline behavior does not verify ACTVERO platform login.

<a id="build-configuration"></a>

## Build configuration

```sh
pnpm run actvero:check
pnpm run actvero:prepare
```

`product.json` owns product identity, public defaults and update configuration. `upstream.lock.json` pins the official baseline; `plugins.lock.json` pins selected plugin versions. Preparation emits configuration-only metadata and does not install plugins. Runtime code and build scripts never read sibling repositories.

The source distribution defaults to `http://127.0.0.1:5194` for local platform development. Set `ACTVERO_PLATFORM_URL` when launching against another deployment, or set `platform.defaultUrl` in a private build profile under `.actvero-builder/`; see [platform address migration](../docs/upgrade-guide/v0.2.0-rc.2/actvero-platform-address/guide.md).

[Configurable builds](building/README.md) define brand assets, build/package commands and host requirements.

## Delivery scope

This development flow integrates login, quota presentation, platform-backed model selection and the [expert, skill and MCP managers](../packages/actvero/capability-ui/README.md). The `平台模型` provider reads the platform catalog and obtains short-lived per-model resource tokens through Electron Main; credentials never enter the renderer or Host. Third-party sidebar/market plugins, signed release installers and update channels remain outside this development flow. Local workspaces and custom model configuration remain available. See the [desktop reference](../apps/desktop/README.md) for official packaging.

[Capability integration and acceptance](capabilities.md).
