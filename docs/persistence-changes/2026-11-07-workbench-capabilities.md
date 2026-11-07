---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-07-workbench-capabilities

English | [中文](2026-11-07-workbench-capabilities.zh.md)

## Summary

Adds an optional capabilityDigest to persisted workbench selection. The native Session records compiled bundled expert instructions and an exact local dependency generation.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-workbench-capabilities
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: "2026-11-07-actvero-workbench-session"
    after: "bc28dfefeaa4c54e6d40cd1b75ae0383f8e8dbad89376ccb973f0d1ed147450d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing selections without the field remain readable. Legacy providers keep their selection behavior; adding a capability bundle to a legacy selection requires explicit reselection before model execution. Current readers reject a changed digest or compiled expert instructions on resume and do not replace the recorded selection. Earlier strict readers reject an unrecognized selection field instead of silently executing different capabilities. The event discriminator and schemaVersion remain unchanged; no committed Session generation is rewritten.

<a id="verification"></a>
## Verification

Focused workbench-runtime and bundled-expert tests passed, including recorded native-loop requests, digest mismatch refusal, explicit reselection, cancellation, provider withdrawal, native Agent disposal, scoped Skill registration and real stdio MCP cleanup. A real Desktop Host test passed for direct tools, Skill/CLI and MCP writing one business file, with three recorded tool results.

<a id="dev-note"></a>
## Dev Note

None.
