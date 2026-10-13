---
kind: upgrade-guide
description: "ACTVERO desktop builds use a local development platform address unless a deployment configures its own address."
---
# ACTVERO platform address

English | [中文](guide.zh.md)

## Change

The default platform address in `actvero/product.json` and the desktop startup fallback is `http://127.0.0.1:5194`. Source builds no longer include a deployment-specific server address. Builds that relied on that default must configure their platform explicitly. Saved runtime address overrides retain precedence.

## Migration

1. For development, set `ACTVERO_PLATFORM_URL` to your platform address before running `pnpm run actvero:dev`.
2. For a packaged deployment, set `platform.defaultUrl` in a private build profile under `.actvero-builder/` and pass it with `--profile` to the [packaging command](../../../../actvero/building/README.md#installer-output). Keep private presets and artwork out of Git.
3. On first launch, verify that Account and Quota settings show the intended platform address before signing in. Existing installations can change the saved address in the same settings page.
