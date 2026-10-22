---
kind: upgrade-guide
description: "ACTVERO expert updates retain local dependency versions and require the updated desktop reader."
---

# ACTVERO expert package updates

English | [中文](guide.zh.md)

## Change

ACTVERO previously rejected differing same-name dependencies during expert ZIP import. The desktop now records the package source `id`, compares `version`, and presents a dependency update plan. Existing conversations retain their exact versions.

After a local skill update, `actvero-capabilities/skills/local/installed.json` contains the current version plus retained `previous` entries. New files live under `versions/<skill-id>/<version-id>`; original package directories remain. Expert records include a Main-owned `packageOrigin` baseline. Older desktop builds do not support these records. Session events and the portable ZIP schema remain unchanged.

## Migration

1. Keep the complete desktop user-data directory when upgrading. Do not delete or rewrite installed skill records to resolve import conflicts.
2. Package authors retain `expert.json`’s `id` and increase its three-part `version` for changed content. Import the ZIP and review the displayed changes. A legacy expert without a source record can be associated only when exactly one local expert has the same name.
3. Resolve flagged local edits or shared dependency conflicts first. Changed MCP templates create disabled version-labelled configurations; review, authorize and enable the new connection in Connectors.
4. Confirm that My experts shows the incoming version, then summon it in a new conversation. Existing conversations retain their snapshot. Use this desktop build or newer to read updated local indexes; this change provides no downgrade migration.
