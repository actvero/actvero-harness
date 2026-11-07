---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-07-actvero-workbench-session

[English](2026-11-07-actvero-workbench-session.md) | 中文

## 概述

记录选中的 Actvero 工作台、业务实例、包版本及可选的随包专家指令。空关联表示取消使用，不删除业务数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-actvero-workbench-session
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: null
    after: "e0b97011626682c4253680ff3365877bbedb1f925407d2141b736dfb5a8dc293"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

不含此事件的已有会话继续有效，投影为未选择工作台。新的 actvero/workbench 判别字段及 schemaVersion 1 校验关联。未声明此事件的读取器会拒绝不可忽略的事件，不会静默丢失已选环境。SESSION_FORMAT_VERSION 不变。

<a id="verification"></a>
## 验证

workbench-runtime.spec.ts 的 6 个测试通过，覆盖业务数据持久化、工作区归属、会话范围内的指令与工具、解除关联、不可用版本及记录工具结果的原生 Agent 循环。

<a id="dev-note"></a>
## 开发备注

无。
