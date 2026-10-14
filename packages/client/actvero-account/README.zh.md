---
description: "通过原生预加载桥接提供 ACTVERO 桌面账户设置、平台品牌和成员额度展示。"
kind: "package-reference"
---

# @actvero/dsh-client-account

[English](README.md) | 中文

## 概述

在官方桌面设置和侧栏中使用 ACTVERO 平台账号。分别查看成员的各额度窗口，修改平台地址时无需填写身份服务 issuer。未登录时仍可使用本地工作区。此插件展示主进程管理的状态，不接收登录凭据。

## 目录

- [使用此插件](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与未交付工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此插件

官方 Web 装配仅在 `ACTVERO_DESKTOP=1` 时启用此私有工作区插件。浏览器入口需要受控原生预加载提供 `window.actveroAccount`。此插件没有配置字段，也不提供独立浏览器登录。通过受支持的[账户开发流程](../../../actvero/README.zh.md)启动。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

Cordis 注册负责账户设置页、侧栏账户入口和平台品牌插槽。渲染框架绑定一个原生状态源，组件不接触 Cordis 上下文。初始快照不会覆盖较新的推送状态，卸载时解除桥接订阅。菜单宽度与侧栏按钮一致，提供设置、个人中心与退出登录；设置页保持紧凑的账户信息卡，将平台地址与当前组织合并展示，并提供积分窗口进度条。切换组织后自动查询新组织的额度，剩余值已包含平台的预留扣减。登录与退出操作保留在侧栏菜单中。 ACTVERO 通过原生插槽提供新会话欢迎语与运行状态文案；字体、主题、计时和动画由原生组件负责，卸载此包后恢复原生文案。

额度余额和上限四舍五入显示为整数积分。进度百分比和无障碍标签使用原始数值，平台账务仍保留原有小数精度。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [登录恢复](../../../actvero/account-recovery.zh.md)
- [官方客户端插槽](../../../docs/subsystems/slots.zh.md)
- [桌面外壳](../../../apps/desktop/README.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

无。

-----

<a id="model-experience"></a>
## 模型体验

无，原生账户界面只展示身份、平台品牌与额度窗口，不增加模型提示、会话事件或工具结果。

#### KV 缓存影响

不改变模型请求前缀。

## 已知限制与未交付工作

<a id="known-limitations-and-deferred-work"></a>

- 账号登录不会直接授予模型、MCP、Skill 或专家权限。平台模型执行、资源令牌安装与正式打包是独立接入工作。
- 离线冷启动保留加密登录，但不伪造缓存身份或额度。额度查询失败仅保留当前同一账号与组织最近的结果。
- 平台未配置 Logo、地址不受支持或图片加载失败时，使用随应用提供的 Actvero 图标。支持同源上传的位图。
