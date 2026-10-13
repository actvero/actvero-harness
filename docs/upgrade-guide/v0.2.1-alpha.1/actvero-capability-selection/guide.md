---
kind: upgrade-guide
description: "ACTVERO skill badges add a browser draft appearance, and the default distribution name changes to Actvero Harness."
---

# ACTVERO capability selection

English | [中文](guide.zh.md)

## Change

The ACTVERO desktop enables `referenceChips` on ui-skill: selected skills become neutral atomic badges whose clipboard and prompt text remains `/name`. Browser drafts now accept the `skill` appearance. Default DSH compositions retain plain skill text. Directory skills appear in the Local skills manager without import, and selecting an expert retains unrelated skills and configured connectors. Exact expert versions still win matching names.

The default distribution is named `Actvero Harness`. Its `com.actvero.desktop` application identifier, data directory and system-encryption identity remain unchanged.

## Migration

1. Rebuild with `pnpm run actvero:build`, quit the existing development instance, then run `pnpm run actvero:start`. No account, connector or Session data reset is required.
2. Custom compositions that want the badges may set `referenceChips: true` on `@deepseek-ai/dsh-client-ui-skill`. No setting is needed for ordinary DSH behavior.
3. Before opening the same browser storage with an older client that rejects the new draft appearance, send or copy any unsent badge draft. The Host Session format and sent `/name` text are unchanged.
4. Confirm a skill in the current workspace’s `.agents/skills` appears in Local skills and inserts a badge with the caret to its right. Confirm unrelated added connectors remain listed with an expert selected. Native application names should show `Actvero Harness`; connected platform branding still owns the UI name.
