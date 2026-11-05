---
description: "本地工作台提供者、持久业务资料与原生 AI 对话。"
kind: package-reference
---

# Actvero 本地工作台

[English](README.md) | 中文

## 概述

本文面向客户端维护者和业务工作台开发者，用于接入本地业务界面、原生对话与持久资料。用户入口与启动命令见 [Actvero 客户端工作台](../../../actvero/workbenches.zh.md)。

## 目录

- [运行与存储](#runtime-and-storage)
- [提供者与界面](#providers-and-interfaces)
- [Model Experience](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="runtime-and-storage"></a>

## 运行与存储

宿主使用 `root` 下的 `state.json` 保存业务记录、常用项及会话关联。写入经过文件锁和原子替换，更新必须携带当前 revision；冲突返回明确错误，损坏或不支持的数据不会被空状态覆盖。卸载提供者保留资料，重新加载相同标识后继续使用。当前格式只支持本地文件，不提供跨设备同步。

直接打开工作台会建立一份默认业务资料，无需命名项目、选择目录或创建会话。用户需要整理独立任务时可以新建项目。第一次打开 AI 助手时，宿主才建立原生 Workspace 和 Session；之后新话题沿用该资料的文件夹，每个话题有独立原生会话记录。已关联资料的目录丢失时阻止新建话题，恢复原目录后重试。

`refreshIntervalMs` 控制界面读取最新状态的间隔，默认 2500 毫秒；`maxImportBytes` 限制归档上传大小，默认 16 MiB。`examples` 控制两个内置参考提供者，默认开启。示例展示创作文本、参考图片与素材说明，不调用图片或视频生成服务。

<a id="providers-and-interfaces"></a>

## 提供者与界面

业务 Host 插件通过 `ctx.actveroWorkbenchRuntime.register(provider)` 提供元信息、初始数据、数据校验和模型指令。Client 插件通过 `ctx.actveroWorkbenches.register(id, Component)` 注册同标识业务界面。两项注册都返回注销函数，由业务插件的 Cordis effect 管理。包的服务端与客户端分别声明对本插件的依赖；可安装归档仍遵循原生 DSH bundle 格式和版本校验。

业务组件接收项目、忙碌状态、保存函数及打开 AI 的函数。业务界面按自身容器宽度排版。宿主提供业务、并排和对话三种视图，使用原生 Conversation Content Factory；视图切换保留同一原生输入框，切换话题使用原生草稿保存，原生新建对话快捷键在当前工作台中建立另一个相关话题。窄容器会减少业务卡片列数，并排区域空间不足时优先显示对话。

工作台首页的归档导入先暂存到 `root/imports`，再交由原生 Plugin Manager 安装；暂存文件保留以便检查失败。安装成功、重启后加载、提供者注册和界面可用是不同结果。旧 DSH 工作台通过兼容市场进入，其会话归属规则独立保留。本地包无需 GitHub 仓库。

## Model Experience

### 本地业务资料工具

#### 模型可见内容

仅关联业务资料的原生会话获得工作台指令及 `actvero_workbench_read`、`actvero_workbench_update`。读取返回当前完整业务数据及 revision；修改先读取，再提交完整 JSON 数据与该 revision。工具执行再次检查会话关联和提供者状态，业务数据通过对应提供者校验。普通会话不暴露这些工具。原生模型请求和工具结果继续写入 Session 日志。

#### Token 影响

关联会话增加提供者指令及两个工具定义。读取和更新返回完整业务记录，结果 token 随内容增长。打开工作台或切换视图不会发送模型请求。

#### KV Cache 影响

同一业务资料的提供者和项目名称保持稳定。切换项目或修改提供者指令会改变对应提示词片段；业务编辑通过工具结果呈现，不改变系统前缀。



## 已知限制与暂缓工作

业务工具只读写本地资料，不提交媒体生成或发布任务；原生对话按所选模型正常计费。业务运行上下文尚未接入组织鉴权、平台模型目录或自动装载内置专家。调用真实模型需要客户端已有可用模型；测试使用模拟适配器验证原生执行链，不代表真实账号验收。

<a id="known-limitations-and-deferred-work"></a>

- 预览尚未接入平台鉴权上下文、媒体生成和工作台专家自动激活。Windows 原生窗口控件及真实业务提供者归档安装需要单独验收。

<a id="dev-note"></a>

### 开发备注

完成 Host 和 Client 构建后运行包内测试及本地工作台浏览器用例。真实账号生成、组织授权和 Windows 原生窗口行为需要单独验收。
