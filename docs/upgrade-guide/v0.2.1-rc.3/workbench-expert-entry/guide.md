---
kind: upgrade-guide
description: "Workbenches enter conversations through contributed experts, while expert switching preserves idle conversations without requiring a filesystem workspace."
---

# Use workbench-contributed experts

English | [中文](guide.zh.md)

## Change

Workbench AI entries move into the expert picker. Loaded AI-enabled workbenches contribute read-only experts, withdrawn on disablement or uninstall. The latest explicit ordinary-expert or workbench-expert selection determines subsequent capabilities; the sources do not stack. Idle conversations can switch experts while retaining their workspace, history and business data. New associated conversations no longer create a `.sessions/<instanceId>` filesystem workspace; existing directories are neither moved nor removed.

Workbench API 1.9 adds expert catalog metadata and local development connections. Attached dev commands publish temporary overlays; unattached commands still only build. Release installation and publication remain separate.

## Migration

1. Summon workbench experts from Add > Expert, or inspect their source in Capability center > Experts > My experts. Existing conversations retain their logged association; select the loaded expert again when its recorded version is unavailable.
2. Authors can supply `expertEntry` name, version, description and portrait, or false to hide the entry. New packages using these fields declare `hostApi: ^1.9.0`; existing AI packages keep their registration API.
3. Export a development connection from the target Harness and run `actvero-workbench attach /project --connection /connection-file` before dev. Inspect status/logs and detach when finished. See the [development guide](../../../../actvero/workbench-development.md#create).
4. After upgrading the kit, run `actvero-workbench skills update --global` to update unchanged shared Skills. Verify through a real task that the expert, business object and preview address the same data.
