---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-07-workbench-capabilities

[English](2026-11-07-workbench-capabilities.md) | 中文

## 概述

为持久化工作台选择新增可选 capabilityDigest。原生会话记录编译后的随包专家指令及精确的本地依赖代次。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-workbench-capabilities
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: "2026-11-07-actvero-workbench-session"
    after: "bc28dfefeaa4c54e6d40cd1b75ae0383f8e8dbad89376ccb973f0d1ed147450d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

缺少该字段的已有选择仍可读取。旧式提供者保持选择行为；为旧关联加入能力包后，必须明确重新选择才能执行模型请求。当前读取方在恢复时拒绝摘要或编译后专家指令变化，不替换原记录。旧版严格读取方拒绝未知的选择字段，避免静默执行其他能力。事件判别字段和 schemaVersion 不变，不改写已提交的会话代次。

<a id="verification"></a>
## 验证

工作台运行时和随包专家的专项测试已通过，覆盖原生循环请求记录、摘要不符拒绝、明确重新选择、加载取消、提供者卸载、原生会话释放、Skill 作用域和实际 stdio MCP 清理。真实 Desktop Host 验收通过，业务工具、Skill/CLI 和 MCP 修改同一份业务文件，并留下三条工具结果。

<a id="dev-note"></a>
## 开发备注

无。
