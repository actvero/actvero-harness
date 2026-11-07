---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-07-actvero-workbench-session

English | [中文](2026-11-07-actvero-workbench-session.zh.md)

## Summary

Records the selected Actvero workbench, business instance, package version and optional bundled expert instructions. A null selection detaches without deleting business data.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-actvero-workbench-session
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: null
    after: "e0b97011626682c4253680ff3365877bbedb1f925407d2141b736dfb5a8dc293"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Sessions without this event remain valid and project no workbench. The new actvero/workbench discriminator and schemaVersion 1 validate the association. Readers without this event declaration reject its non-ignorable event instead of silently losing the selected environment. SESSION_FORMAT_VERSION is unchanged.

<a id="verification"></a>
## Verification

workbench-runtime.spec.ts: 6 tests passed, covering durable business state, workspace membership, scoped instructions and tools, detach, unavailable versions and the native Agent loop with recorded tool results.

<a id="dev-note"></a>
## Dev Note

None.
