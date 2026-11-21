---
kind: upgrade-guide
description: The bundled workbench CLI replaces watched development attachments with one-shot version installation.
---

# Update local workbenches with one command

English | [中文](guide.zh.md)

## Change

The installed Actvero Harness CLI applies one version at a time with `update`. Existing workbench projects keep their package name and use a higher version for each update. The `attach`, `dev`, `logs` and `detach` commands are removed. `status` now takes a package name and a connection file.

## Migration

1. Obtain a fresh connection file from the target Harness. Use `bind` on existing projects to refresh the bundled guidance.
2. Run `actvero-workbench update <project> --connection <connection-file> --json` after development and local checks. Replace automation that invokes the previous watch commands with this call.
3. Check the installed version with `actvero-workbench status <package-name> --connection <connection-file> --json`. Open the workbench and verify the new version.
