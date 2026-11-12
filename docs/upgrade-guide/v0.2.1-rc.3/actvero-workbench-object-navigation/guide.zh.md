---
kind: upgrade-guide
description: ACTVERO 工作台直接打开当前业务对象时可不携带历史版本信息。
---

# ACTVERO 工作台对象导航

[English](guide.md) | 中文

## 变更

扩展 API 1.7 增加直接业务对象导航。`WorkbenchObjectLocation.revision` 改为可选：历史引用链接保留原版本，直接 `objectId` 展示请求没有历史内容快照。读取此字段的工作台作者须处理其缺省值。已保存的引用和业务数据保持不变。

## 迁移

1. 业务组件使用 `workbench.location.objectId` 打开当前对象。仅在 `workbench.location.revision` 有值时显示历史版本，不使用实例版本替代。
2. Agent 工具需要打开对象时，声明 `hostApi: "^1.7.0"`、注册 `objectNavigation: true`，并提供宿主提供器的 `resolveObject`。以 `mode: "business"` 传入 `objectId`，或通过 `workbench_open` 传入 `object_id`。
3. 重新构建工作台，验证直接导航、历史引用导航及对象不存在时的失败提示。确认查看其他对象不会改变调用对话的关联。参见[工作台开发](../../../../actvero/workbench-development.zh.md)。
