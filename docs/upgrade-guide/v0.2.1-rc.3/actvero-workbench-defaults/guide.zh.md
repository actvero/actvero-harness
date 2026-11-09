---
kind: upgrade-guide
description: Actvero 不再默认加载旧工作台宿主和项目清单。
---

# Actvero 默认工作台

[English](guide.md) | 中文

## 变更

Actvero 安装包 0.1.19 不再默认显示「DSH 工作台」侧栏入口，也不自动注册「项目清单」。全新 Profile 的「我的工作台」为空。使用随包清单或旧兼容宿主的 Profile 需显式启用它们。用户手动安装的 Actvero 工作台仍保留在列表中。本次变更保留历史对话、实例元信息和业务目录，不删除或迁移其中的内容。已关联停用 provider 的对话需重新启用该 provider 后才能继续使用其能力。

## 迁移

1. 使用空目录默认行为无需修改配置。打开「工作台 → 我的工作台」，导入业务包或选择「开发工作台」。
2. 开发 Profile 如需清单，在该 Profile 的 `cordis.patch.yml` 中，为 `actvero-capability-ui` 条目的 `config` 添加 `exampleWorkbench: true`，保留已有 `dataDirectory` 和其他配置。通过 patch 设置 `config` 时，需一并包含这些已有字段。恢复旧内容时不要改用新数据目录。
3. Profile 如需旧兼容宿主，将 `actvero-workbenches` 条目的 `disabled` 设为 `false`，保留已有 `root` 配置。这会恢复独立的「DSH 工作台」入口。
4. 重启 Profile，确认列表只显示预期工作台，并在对应工作台中检查保留的数据。参见[工作台配置](../../../../packages/actvero/capability-ui/README.zh.md)和[客户端工作台](../../../../actvero/workbenches.zh.md)。
