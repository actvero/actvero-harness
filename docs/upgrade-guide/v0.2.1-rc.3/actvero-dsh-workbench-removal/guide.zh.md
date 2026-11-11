---
kind: upgrade-guide
description: "Actvero 桌面端移除 DSH 工作台市场及其旧版工作台注册服务。"
---

# Actvero 桌面端移除 DSH 工作台

[English](guide.md) | 中文

## 变更

Actvero 桌面端移除「DSH 工作台」侧栏入口、公开市场和 `ctx.desktopWorkbenches` 注册服务。本地和组织工作台统一从侧栏的「工作台」打开。

## 迁移

1. 升级前，在「插件」里停用依赖 `ctx.desktopWorkbenches` 的已安装工作台。如果曾在桌面 Profile 的 `cordis.patch.yml` 中配置 `actvero-workbenches`，删除对应的配置项。
2. 如需继续使用旧工作台，将注册接口改为 `ctx.actveroWorkbenches.register(descriptor, Component)`，并按[开发说明](../../../../actvero/workbench-development.zh.md)构建 Actvero 工作台包。
3. 升级后，在「工作台 → 我的工作台」导入重新构建的工作台包，点击卡片确认能打开业务页。
