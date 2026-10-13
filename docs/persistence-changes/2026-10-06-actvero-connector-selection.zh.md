---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-06-actvero-connector-selection

[English](2026-10-06-actvero-connector-selection.md) | 中文

## 概述

新增 actvero/connectors 事件与原生投影，持久保存有作用域的对话连接器选择。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-actvero-connector-selection
baseline: false
changes:
  - root: "event:actvero/connectors"
    previous: null
    after: "da8b6b23302d47f7794076b9f0570f4993b3182c3dd8e18e80f601d6a09b9ffb"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 Session 日志仍有效，初始选择为空。此新增的必读事件不改变 Session 头版本。恢复与分叉回放选择；专家必需连接器保持开启，其他平台／账号／组织的选择不生效。不认识此事件的旧构建会拒绝包含它的日志，不支持这些对话降级。事件不保存连接健康状态或凭证。

<a id="verification"></a>
## 验证

聚焦的投影、选择器与原生弹窗回归测试通过。Main 连接器意图回归验证了必需项开启、可选项关闭、不重复恢复与不同作用域隔离。Host 与 Client TypeScript 编译通过。

<a id="dev-note"></a>
## 开发备注

无。
