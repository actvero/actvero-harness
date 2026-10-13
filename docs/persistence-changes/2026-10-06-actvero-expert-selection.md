---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-06-actvero-expert-selection

English | [中文](2026-10-06-actvero-expert-selection.zh.md)

## Summary

Adds the actvero/expert event containing the exact selected expert snapshot identifier and public display metadata, or null to clear it.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-actvero-expert-selection
baseline: false
changes:
  - root: "event:actvero/expert"
    previous: null
    after: "55a0846b3e88363b3c388464f4dd30081650b5aeecdb441d02be16a37a8d57f5"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This is an additive event with schemaVersion 1; existing event types and Session header versions do not change. Sessions without this event retain native behavior. ACTVERO restores and forks the recorded selection through its native projection, checks the immutable snapshot and current authorization before execution, and never replaces it with the latest catalog release. Other clients do not gain ACTVERO execution compatibility by being able to read the log.

<a id="verification"></a>
## Verification

The focused migration regression passed 127 tests across 15 files. The expert projection test exercises restore, checkpoint/fork and clear, and the skill view tests verify exact definitions, cancellation and ordinary discovery fallback. The built official Host composition also passed with ACTVERO enabled and disabled.

<a id="dev-note"></a>
## Dev Note

None.
