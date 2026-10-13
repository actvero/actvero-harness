---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-06-actvero-expert-selection

[English](2026-10-06-actvero-expert-selection.md) | 中文

## 概述

新增 actvero/expert 事件，记录所选专家的精确快照标识与公开展示信息，或通过 null 清除选择。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-actvero-expert-selection
baseline: false
changes:
  - root: "event:actvero/expert"
    previous: null
    after: "55a0846b3e88363b3c388464f4dd30081650b5aeecdb441d02be16a37a8d57f5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该事件采用 schemaVersion 1，属于新增事件，不改变已有事件或 Session 头版本。未包含该事件的会话保持原生行为。ACTVERO 通过原生投影恢复和分叉所记录的选择，执行前校验不可变快照及当前授权，不自动替换为目录中的最新版本。其他客户端能够读取日志，不代表其支持 ACTVERO 专家执行。

<a id="verification"></a>
## 验证

迁移回归共 15 个文件、127 个测试通过。专家投影测试覆盖恢复、检查点与分叉、清除选择；技能视图测试覆盖精确内容、取消及普通发现回退。真实构建的官方宿主在 ACTVERO 启用和关闭两种模式下均加载通过。

<a id="dev-note"></a>
## 开发备注

无。
