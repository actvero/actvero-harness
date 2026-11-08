---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-09-workbench-objects

English | [中文](2026-11-09-workbench-objects.zh.md)

## Summary

Adds schemaVersion 2 workbench selections containing an author-owned business object identifier and recorded display name.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-09-workbench-objects
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: "2026-11-07-workbench-capabilities"
    after: "7968631b3590972faca082349a1f6941a4c5217fe70394c7cff89b7d26c8d6f8"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Session header version remains unchanged. New readers accept existing schemaVersion 1 whole-instance and detach records and schemaVersion 2 object bindings. The previous workbench reader explicitly rejects schemaVersion values other than 1, so it refuses object-bound conversations instead of resuming them without their target. Whole-instance writers still use schemaVersion 1. Projection stateVersion 2 rebuilds derived selections from the durable log; object content remains in author-owned storage. Optional TypeScript undefined values do not add serialized fields.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/actvero/capability-ui/tests/workbench-runtime.spec.ts packages/actvero/capability-ui/tests/workbench-projection.spec.ts packages/actvero/capability-ui/tests/workbench-conversation.client.spec.ts packages/actvero/capability-ui/tests/workbench-commands.client.spec.ts packages/actvero/capability-ui/tests/workbench-reference.client.spec.ts packages/actvero/experts/tests/workbench.spec.ts scripts/actvero-workbench-skill.spec.ts: 52 tests passed. pnpm run build: all 9 gates passed. Replay tests cover legacy selection, object selection, fork retention, detach, unsupported schema versions and incomplete records; runtime tests cover target isolation, conditional reuse, deleted targets and cancellation.

<a id="dev-note"></a>
## Dev Note

None.
