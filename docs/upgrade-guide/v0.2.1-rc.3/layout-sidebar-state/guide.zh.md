---
kind: upgrade-guide
description: "自行构造 LayoutController 或实现 ILayout 的客户端插件需要提供响应式侧栏展开状态。"
---

# 为自定义布局提供侧栏展开状态

[English](guide.md) | 中文

## 变更

`LayoutController` 构造函数增加必需的第四个参数 `sidebarExpanded: HostObservable<boolean>`；`ILayout` 增加该可观察值和 `setSidebarExpanded(expanded)`。直接构造控制器、自行提供 `ctx.layout` 或维护完整接口替身的插件需要调整。使用宿主布局服务的工作台作者无需更改。

## 迁移

1. 更新布局提供者，将与根布局相同的数据源作为第四个构造参数。可观察值反映当前窗口下的实际展开状态，包括窄窗口的展开覆盖；不要用固定布尔值替代真实状态。
2. 自定义 `ILayout` 实现同时提供 `sidebarExpanded` 和 `setSidebarExpanded(expanded)`；状态相符时不切换，保留原有侧栏宽度和窄窗口规则。测试替身按其场景提供对应状态。
3. 验证重复设置相同状态不会反复切换，宽窄窗口中状态与界面一致，工作台退出后能恢复进入前的导航展开状态。参见[布局接口](../../../../packages/client/ui-layout/README.zh.md#understand-the-implementation)。
