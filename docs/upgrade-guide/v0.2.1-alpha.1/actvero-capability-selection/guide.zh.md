---
kind: upgrade-guide
description: "ACTVERO 技能徽标增加浏览器草稿外观，默认发行名称改为 Actvero Harness。"
---

# ACTVERO 能力选择

[English](guide.md) | 中文

## 变更

ACTVERO 桌面对 ui-skill 启用 `referenceChips`：选中的技能显示为中性原子徽标，剪贴板和提示词文本仍为 `/name`。浏览器草稿新增接受 `skill` 外观。默认 DSH 组合仍使用普通技能文本。目录技能无需导入即可显示在「本机技能」，选择专家后仍保留其他技能和已配置连接器，同名技能仍优先使用专家固定版本。

默认发行名称为 `Actvero Harness`，其 `com.actvero.desktop` 应用标识、数据目录与系统加密身份保持不变。

## 迁移

1. 使用 `pnpm run actvero:build` 重新构建，退出旧开发实例后运行 `pnpm run actvero:start`。不需要重置账号、连接器或 Session 数据。
2. 自定义组合需要徽标时，可在 `@deepseek-ai/dsh-client-ui-skill` 中设置 `referenceChips: true`；普通 DSH 行为无需设置。
3. 使用不支持新草稿外观的旧客户端打开相同浏览器存储前，先发送或复制未发送的徽标草稿。Host Session 格式和已发送的 `/name` 文本不变。
4. 确认当前工作区 `.agents/skills` 中的技能显示在「本机技能」，插入后光标位于徽标右侧；选中专家后，其他已添加连接器仍在列表中。原生应用名应显示 `Actvero Harness`，已连接平台仍决定界面品牌名。
