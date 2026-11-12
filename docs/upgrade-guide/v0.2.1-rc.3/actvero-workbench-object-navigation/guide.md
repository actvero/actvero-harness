---
kind: upgrade-guide
description: ACTVERO workbench navigation can omit historical revision metadata when opening a current business object.
---

# ACTVERO workbench object navigation

English | [中文](guide.zh.md)

## Change

Extension API 1.7 adds direct business-object navigation. `WorkbenchObjectLocation.revision` is optional: saved-reference links retain their revision, while a direct `objectId` presentation request has no historical content snapshot. Workbench authors who read this field must handle its absence. Stored references and business data are unchanged.

## Migration

1. In business components, use `workbench.location.objectId` to open the current object. Show historical revision information only when `workbench.location.revision` is defined; do not substitute the instance revision.
2. To open an object from Agent tools, declare `hostApi: "^1.7.0"`, register `objectNavigation: true`, and supply the Host provider’s `resolveObject`. Send `objectId` with `mode: "business"`, or `object_id` through `workbench_open`.
3. Rebuild the workbench and verify direct navigation, saved-reference navigation and missing-object failure. Confirm that viewing another object does not change the calling conversation’s binding. See [workbench development](../../../../actvero/workbench-development.md).
