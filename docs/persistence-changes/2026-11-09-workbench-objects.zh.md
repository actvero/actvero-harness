---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-09-workbench-objects

[English](2026-11-09-workbench-objects.md) | 中文

## 概述

工作台关联新增 schemaVersion 2，记录作者自定义的业务对象标识及绑定时的显示名称。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-09-workbench-objects
baseline: false
changes:
  - root: "event:actvero/workbench"
    previous: "2026-11-07-workbench-capabilities"
    after: "7968631b3590972faca082349a1f6941a4c5217fe70394c7cff89b7d26c8d6f8"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

Session 头版本保持不变。新读取器兼容已有 schemaVersion 1 的实例级关联、解绑记录和 schemaVersion 2 的对象关联。旧工作台读取器明确拒绝非 1 的 schemaVersion，因此会拒绝对象对话，不会丢失目标后继续运行。实例级关联仍写版本 1。投影 stateVersion 2 从持久日志重建派生关联；业务内容仍由作者存储。可选 TypeScript undefined 值不增加序列化字段。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/actvero/capability-ui/tests/workbench-runtime.spec.ts packages/actvero/capability-ui/tests/workbench-projection.spec.ts packages/actvero/capability-ui/tests/workbench-conversation.client.spec.ts packages/actvero/capability-ui/tests/workbench-commands.client.spec.ts packages/actvero/capability-ui/tests/workbench-reference.client.spec.ts packages/actvero/experts/tests/workbench.spec.ts scripts/actvero-workbench-skill.spec.ts：52 项测试通过。pnpm run build：9 项全部通过。回放测试覆盖旧关联、对象关联、分支保留、解绑、未知版本和不完整记录；运行时测试覆盖目标隔离、条件复用、对象删除及取消。

<a id="dev-note"></a>
## 开发备注

无。
