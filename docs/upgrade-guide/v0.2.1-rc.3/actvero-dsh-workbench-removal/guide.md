---
kind: upgrade-guide
description: "Actvero Desktop removes the DSH Workbenches market and its legacy workbench registration service."
---

# Actvero Desktop removes DSH Workbenches

English | [中文](guide.zh.md)

## Change

Actvero Desktop removes the DSH Workbenches sidebar entry, public market and `ctx.desktopWorkbenches` registration service. Users open local and organization workbenches from Workbenches in the sidebar.

## Migration

1. Before upgrading, disable installed workbench packages that require `ctx.desktopWorkbenches` from Plugins. If you explicitly configured the `actvero-workbenches` row in the Desktop Profile's `cordis.patch.yml`, remove those entries.
2. To continue using a legacy workbench, port it to `ctx.actveroWorkbenches.register(descriptor, Component)` and build an Actvero package using the [development guide](../../../../actvero/workbench-development.md).
3. In the upgraded app, open Workbenches → My workbenches and import the rebuilt package. Verify that the card opens its business view.
