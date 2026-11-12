---
kind: upgrade-guide
description: "Actvero removes the bundled Project checklist and starts with an empty workbench library."
---

# Actvero starts with an empty workbench library

English | [中文](guide.zh.md)

## Change

Actvero Harness 0.1.25 removes the bundled Project checklist. My workbenches starts empty on a new installation. An upgraded profile still lists the workbenches you installed. Earlier checklist documents and conversation history are retained.

## Migration

1. Open Workbenches → My workbenches and verify that the bundled Project checklist is gone.
2. If a previous conversation uses the bundled checklist, remove its workbench attachment and select a loaded workbench before sending the next message.
3. To try the checklist template, follow the [workbench development guide](../../../../actvero/workbench-development.md) and import the resulting package.
