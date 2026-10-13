---
description: "通过桌面账户使用 Actvero 平台模型，由平台管理路由并提供短期资源授权。"
kind: "package-reference"
---

# @actvero/dsh-model-gateway

[English](README.md) | 中文

## 概述

通过原生模型选择器使用所选 Actvero 账户和组织可访问的模型。平台提供模型元数据、路由和资源授权。适配器支持兼容 OpenAI 的聊天响应，并依赖 Actvero Electron Main 桥接获取访问权限。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用本包

[Actvero 桌面组合](../../../actvero/README.zh.md)将此插件与原生 `llm` 服务一起挂载。连接有权限的账户后，可在模型选择器中选择平台提供方。平台管理端点和模型访问设置；本插件接受空配置对象，不提供可编辑的提供方凭据字段。

插件向 Electron Main 请求 `llm:catalog` 和各模型的 `llm:<model-uuid>` 资源令牌。长期登录凭据留在 Main 存储中。Host 使用短期令牌请求目录和生成结果；渲染器不接收 bearer 令牌。缺少 Main IPC 通道时，插件会注册设置项，但不能提供模型适配器。

<a id="understand-the-implementation"></a>

## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

[适配器](src/index.ts)将平台聊天模型映射为 DSH 模型元数据，准备资源专属路由，并将原生消息和工具 schema 转为兼容 OpenAI 的请求。SSE 或缓冲 JSON 响应会被转换为原生文本、推理、工具调用、用量和结束分片。账户变化通过 Main 桥接使目录缓存失效。

图片消息通过附件服务取得有大小限制的请求字节。文件附件以原生文本句柄表示。取消和平台 HTTP 失败以原生 LLM 错误传递。

</details>

<a id="model-experience"></a>

## 模型体验

### 平台聊天请求

#### 模型看到的内容

所选平台模型通过 `messages` 接收原生系统提示词、会话消息和支持的图片，通过 `tools` 接收启用的工具 schema。账户页面、目录浏览和登录凭据不进入提示词。返回的文本、推理和工具调用遵循正常的 DSH 记录流程。

#### Token 影响

提示词、历史、工具 schema 和图片内容计入所选模型的请求。刷新目录不会发起生成请求。用量来自平台响应；可用的缓存输入计数与未缓存输入分别记录。

#### KV Cache 影响

浏览目录不改变提示词前缀。模型选择、会话内容和启用能力可能改变后续请求；缓存复用取决于所选平台提供方。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 适配器依赖 Actvero 桌面 IPC 桥接和可用的平台账户。独立 Host 进程没有平台适配器。
- 传输实现兼容 OpenAI 的聊天生成。目录中出现支持范围外的操作，不代表已支持其他模型协议或媒体生成 API。
- 图片请求需要原生附件服务。平台控制模型访问权限和资源令牌有效期。

<a id="dev-note"></a>

### 开发备注

真实账户的模型访问由对应 Actvero 部署负责验证；仓库文档检查不调用该外部服务。
