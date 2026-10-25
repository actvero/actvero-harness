---
kind: upgrade-guide
description: Older ACTVERO desktops cannot read new compact platform skill installation paths.
---

# ACTVERO platform skill installation paths

English | [中文](guide.zh.md)

## Change

New platform skill installations use `p/<32-hex-id>` instead of `packages/<skill-id>/<installation-id>` under the account-scoped skills directory. This shortens paths on Windows. The updated desktop reads both layouts and leaves existing packages in place. Older desktops reject installation records containing the compact layout; sharing an updated user-data directory with an older binary is unsupported.

## Migration

1. Upgrade the ACTVERO desktop before installing new platform skill versions. No manual move or registry edit is required.
2. Summon an expert and confirm its required skills are available. Existing conversation snapshots retain their exact versions and paths.
3. If a downgrade is required, use a separately backed-up pre-upgrade user-data directory. Do not rewrite installation records or move package folders manually.
