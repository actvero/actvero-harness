---
name: checklist-operations
description: 读取和更新当前工作台的项目清单。
---

# 清单操作

[English](SKILL.md) | 中文

使用当前会话的 workbench_read 和 workbench_action，按工具提供的实例与修订号操作。先读后写，只执行用户要求的操作；写入成功后业务页面会自动刷新。不要通过修改插件安装目录或浏览器 localStorage 绕过 Host 数据。

对话已关联任务时，始终以该任务为操作目标，不跟随画面选区变化。使用 checklist_review 读取该任务并返回保存的结果卡片；未关联任务的对话检查整个清单。引用标签只提供捕获时的上下文，不代表可以修改其他任务。
