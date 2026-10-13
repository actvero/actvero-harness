---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-06-actvero-connector-selection

English | [中文](2026-10-06-actvero-connector-selection.zh.md)

## Summary

Adds the actvero/connectors event and native projection for durable scoped conversation connector choices.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-actvero-connector-selection
baseline: false
changes:
  - root: "event:actvero/connectors"
    previous: null
    after: "da8b6b23302d47f7794076b9f0570f4993b3182c3dd8e18e80f601d6a09b9ffb"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session logs remain valid and start with empty choices. This new required-on-read event does not change the Session header. Resume and forks replay the choices; required expert connectors remain on and choices from another platform/account/organization do not apply. Older builds that do not recognize this event refuse logs containing it; downgrading those conversations is not supported. Connection health and credentials are not stored in the event.

<a id="verification"></a>
## Verification

The focused projection, selector and native popup regression tests pass. The Main connector-intent regression passes for required on, optional off, unchanged restore and foreign-scope isolation. Host and Client TypeScript builds pass.

<a id="dev-note"></a>
## Dev Note

None.
