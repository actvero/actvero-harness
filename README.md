<div align="center">

<img src="actvero/icon.svg" alt="Actvero" width="88" height="88">

# Actvero Harness

[English](README.en.md) | 中文

**Actvero 企业智能化解决方案的桌面 Agent。**

[核心能力](#features) · [配套中台](#actvero-platform) · [开始使用](#getting-started) · [开发指南](#development) · [MIT 协议](LICENSE)

</div>

Actvero Harness（`actvero-harness`）是基于 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 开发的桌面 Agent。它将 Actvero 智能中台提供的模型、专家、Skills 和 MCP 工具接入本地工作区，帮助用户处理文件、执行任务，并检查交付成果。

![Actvero Harness 工作区中的对话、任务成果与图纸预览](actvero/assets/readme/workspace.png)

<p align="center">在同一个工作区里，与专家协作、跟进任务、查看交付文件。</p>

<a id="features"></a>

## 核心能力

把组织提供的 AI 能力用到具体工作中。

| 能力 | 可以做什么 |
| --- | --- |
| 工作区与会话 | 围绕工作目录组织任务，管理对话历史与相关文件。 |
| 专家 | 选择平台专家或个人专家，将任务指令与所需的 Skills、工具组合起来。 |
| Skills 与 MCP 连接器 | 复用工作方法，让会话连接获准的本地工具和业务系统。 |
| 任务执行 | 由 Agent 在模型请求和工具调用之间推进任务，在对话中展示进度与结果。 |
| 文件与预览 | 在对话旁查看生成的文档、图纸和其他交付文件。 |
| 平台账号与模型 | 登录所属组织，选择获准的模型，查看中台返回的额度。 |
| 本地配置 | 使用已配置的模型服务、本机 Skills 和自定义 MCP 连接。 |

### 专家、技能与连接器

按分类浏览专家，为任务选择需要的能力。专家组合工作指令与能力依赖；实际可用的工具取决于已安装的 Skills、连接器配置和账号权限。

![Actvero Harness 专家管理界面中的燃气设计专家与 PPT 专家](actvero/assets/readme/experts.png)

图中展示的是已配置的专家示例，相关专业能力需要配套的专家包与工具。

### 账号与额度

在桌面端查看账号、当前组织、平台连接和剩余额度。额度周期与限制由所连接的中台配置。

![Actvero Harness 账号设置与剩余额度，邮箱和平台地址已遮挡，使用测试组织](actvero/assets/readme/account-quota.png)

<a id="actvero-platform"></a>

## Actvero 解决方案的一部分

Actvero 智能中台负责管理、授权和分发企业 AI 能力，Actvero Harness 负责使用这些能力，在桌面端执行具体任务。

| | Actvero 智能中台 | Actvero Harness |
| --- | --- | --- |
| 运行位置 | 企业服务器 | 用户电脑 |
| 管理对象 | 组织、成员、模型、专家、Skills、MCP 资源与额度 | 工作区、会话、任务上下文、工具执行与输出文件 |
| 提供结果 | 获得授权的能力及经过平台的使用记录 | 用户可以检查和使用的工作成果 |

使用平台资源需要可访问的 Actvero 服务与相应账号权限。本地模式也支持单独配置能力；只有经过中台的请求，才纳入对应的平台访问控制和计量。

<a id="getting-started"></a>

## 开始使用

组织部署请向 Actvero 管理员获取桌面应用与平台地址。从源码开发或构建自己的发行包，请参阅[桌面开发指南](actvero/README.zh.md)与[构建和打包指南](actvero/building/README.zh.md)。

1. 连接所在组织的 Actvero 中台，登录账号。
2. 根据提示确认组织，选择可用的模型或专家。
3. 选择工作区，描述任务并提供相关文件。
4. 查看执行过程，按需补充信息或确认操作，检查最终成果。

也可以进入本地模式，自行配置模型与工具。组织资源和平台额度信息需要连接中台后使用。

底层 DSH 运行时处于开发者预览阶段，兼容性可能发生变化。运行能够访问文件、命令或外部服务的 Agent 前，请阅读[安全说明](SAFETY.zh.md)。

<a id="development"></a>

## 开发指南

本仓库包含桌面应用、DSH 运行时及 Actvero 集成，Actvero 智能中台在独立仓库中维护。

| 文档 | 用途 |
| --- | --- |
| [桌面开发](actvero/README.zh.md) | 准备开发环境，启动 Actvero 账号流程。 |
| [构建和打包](actvero/building/README.zh.md) | 配置应用品牌，生成桌面安装包。 |
| [Windows 安装包](actvero/building/windows.zh.md) | 在 Windows 上准备工具链、打包并验收 EXE。 |
| [专家包](actvero/expert-package.zh.md) | 将专家及其 Skills、连接器依赖打包。 |
| [能力集成](actvero/capabilities.zh.md) | 了解桌面端如何接入专家、Skills 与 MCP。 |
| [开发规范](docs/development.zh.md) | 配置仓库环境，了解构建与测试流程。 |
| [架构说明](docs/architecture.zh.md) | 了解 DSH 的插件架构与扩展方式。 |

<a id="run"></a>

<a id="run-from-source"></a>

### DSH Web 与插件开发

仓库也保留了 DSH 的 Web 与插件开发路径，环境准备和应用启动命令见[开发指南](docs/development.zh.md)；Actvero 的原生账号与能力集成使用上方的桌面开发入口。

使用编程 Agent 参与开发时，请遵循 [AGENTS.md](AGENTS.md)。

## 基于 DeepSeek Harness 开发

Actvero Harness 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的衍生项目，上游由 [DeepSeek AI](https://deepseek.com) 开发。DSH 提供 Agent 运行时与插件架构，并由 [Cordis](https://github.com/cordiverse/cordis) 支撑。

Actvero 在此基础上增加企业中台集成，包括桌面身份与组织接入、模型网关、专家、Skills 和 MCP 资源。项目保留上游版权、许可证与第三方声明，所采用的运行时基线记录在 [upstream.lock.json](actvero/upstream.lock.json) 中。

感谢 DeepSeek Harness、Cordis 及相关开源社区提供的基础与贡献。

## 开源协议

本项目采用 [MIT 协议](LICENSE)。第三方组件保留各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
