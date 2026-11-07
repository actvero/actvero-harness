---
kind: upgrade-guide
description: "New ACTVERO workbench conversations use separate working directories; business files must resolve through the runtime environment."
---
# ACTVERO workbench business directories

English | [中文](guide.zh.md)

## Change

New linked workbench conversations use `.sessions/<instanceId>` beneath the configured files root instead of the business directory as their working directory. Workbenches that locate business files using their current directory or relative paths must use the environment's `dataDirectory`. Existing business directories, JSON state, instance identifiers, association events and existing session working directories remain intact; no business files are moved.

New custom-storage providers default to AI disabled and enable it with `ai: true`. Legacy top-level `initial/reduce/actionHelp` providers retain their JSON behavior and enabled AI default; providers using the new `storage` adapter should declare their AI choice explicitly.

Bundled capability associations record an exact dependency digest. A changed digest or compiled instructions block later requests on resume; select the currently installed workbench again. Existing Session records remain readable. Detachment and provider unregistration await capability disposal; manually invoking the disposer returned by `register()` must be awaited, while calls owned through `ctx.effect` need no rewrite.

## Migration

1. Obtain the instance with `runtime.open(id)`, then its `dataDirectory` with `runtime.environment(instance)` in the Host service. Resolve business file paths from that directory instead of the process or session directory. See the [local development guide](../../../../actvero/workbench-development.md#storage).
2. Check file arguments in bundled experts, MCP and CLI integrations and pass an explicit business directory; a path does not replace native access authorization.
3. Retain the workbench identifier, rebuild and install. Open an existing associated conversation, then create a new one and confirm both access the original business content. Existing users need not move files.
