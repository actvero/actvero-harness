---
kind: upgrade-guide
description: Actvero stops loading the legacy workbench host and Project checklist by default.
---

# Actvero workbench defaults

English | [中文](guide.zh.md)

## Change

Actvero installer 0.1.19 removes the default DSH Workbenches sidebar entry and automatic Project checklist registration. A fresh profile shows an empty My workbenches catalog. Profiles that use the bundled checklist or legacy compatibility host must enable them explicitly. Existing manually installed Actvero workbenches remain listed. The change preserves conversations, instance metadata and business directories; it does not delete or migrate their contents. Conversations linked to a disabled provider cannot continue using it until that provider is enabled again.

## Migration

1. For the empty default, no configuration change is needed. Open Workbenches → My workbenches and import your business package or choose Develop workbench.
2. If a development profile needs the checklist, add `exampleWorkbench: true` to the `actvero-capability-ui` row's `config` in that profile's `cordis.patch.yml`, retaining its existing `dataDirectory` and other settings. A patch that sets `config` must include those existing fields. Do not point it at a new data directory to recover old content.
3. If a profile needs the legacy host, set `disabled: false` on its `actvero-workbenches` row. Keep its existing `root` configuration. This restores the separate DSH Workbenches entry.
4. Restart the profile and confirm only the intended workbenches appear. Verify retained data in the corresponding workbench. See [workbench configuration](../../../../packages/actvero/capability-ui/README.md) and [client workbenches](../../../../actvero/workbenches.md).
