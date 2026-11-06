# 本地工作台开发

[English](workbench-development.md) | 中文

## 概述

本文面向已配置 Actvero 仓库开发环境的工作台开发者：从项目清单模板开始，修改业务界面，构建一个可导入桌面客户端的本地安装包。无需 GitHub 账号、仓库地址或发布服务。模板使用当前仓库的编译器；这里的命令在仓库根目录运行。

## 目录

- [创建和打包](#create)
- [导入和验收](#install)
- [包格式](#format)
- [修改业务](#business)
- [限制](#limits)

<a id="create"></a>

## 创建和打包

先按[客户端开发说明](workbenches.zh.md)准备仓库依赖。创建命令只接受尚不存在的目标目录，保护已有文件。第二个参数是稳定包名，同一个工作台后续版本保持包名不变。

```sh
pnpm run actvero:workbench create .artifacts/my-checklist @local/my-checklist
pnpm run actvero:workbench pack .artifacts/my-checklist .artifacts/workbenches
pnpm run actvero:workbench check .artifacts/workbenches/local-my-checklist-1.0.0.tgz
```

`create` 复制可编辑的项目清单；`pack` 编译 Host 和 Client、生成 bundle patch，并输出经过校验的 `.tgz`、字节数与 SHA-256。打包不修改业务源码，不执行安装或发布。输出文件同名时替换先前的构建产物；构建失败保留原产物。输出目录省略时使用项目的 `dist`。

`check` 复用客户端导入预检，并检查格式版本、版本声明、非空入口文件以及重复、越界和链接路径。它不执行工作台代码，不能证明业务功能正常。客户端还会在安装时执行当前运行版本的兼容性检查；开发命令不会跳过这一步。

<a id="install"></a>

## 导入和验收

启动 Actvero 开发客户端，打开「工作台 → 我的工作台」，点击「导入工作台」并选择输出包。若结果要求重启，使用「Harness → 重启 Harness」。成功加载后，卡片和左侧工作台切换菜单会出现「项目清单」。内置示例仍可用于参考；独立包的详情显示作者「本地开发」，以便区分。

打开独立包，勾选一项，返回管理页并重新打开，再刷新客户端后重新打开，检查进度仍在。检查预览图、侧栏展开/收起、浅色/深色以及窄窗口。首次打开不创建会话，也不要求指定工作区。安装结果、卡片出现、切换菜单与真实业务界面分别验收。

当前管理器拒绝重复安装同名包；需要替换时先通过插件管理卸载，再导入新包。安装流程的进一步限制见[工作台说明](workbenches.zh.md)。不要把安装成功写成已完成业务验收。

<a id="format"></a>

## 包格式

格式标识为 `dsh.actveroWorkbench: 1`。交付物使用 npm 兼容 `.tgz`，内容位于 `package/` 目录；包大小不超过 8 MiB，解压内容不超过 32 MiB。稳定身份由 npm 包名承担，业务名称与版本在运行时注册时分别读取 `workbench.json` 和 `package.json`。

| 文件或字段 | 用途 |
|---|---|
| `package.json.name` / `version` | 稳定包名和完整 SemVer 版本；模板注册标识等于包名 |
| `engines.dsh` | 所支持的 DSH 运行时版本范围；模板锁定当前开发基线 |
| `dsh.bundle.patch` | 指向 `./cordis.patch.yml`，把包加入当前 Profile |
| `dsh.client` | 声明 Web 客户端及先加载的 `@actvero/dsh-capability-ui` 等依赖 |
| `exports["."]` / `exports["./client"]` | 本工具输出的 `./lib/index.js` 和 `./lib/client.js` |
| `workbench.json` | 源码中的名称、介绍、分类、作者和标签；编译时纳入客户端 |
| `src/client/assets/` | 源码预览图；通过图片导入编入客户端，不依赖远程图床 |
| `src/index.ts` | Host 插件入口；模板无 Host 业务服务 |
| `src/client/index.ts` | 使用 Cordis effect 注册卡片与业务组件，卸载时注销 |

构建产物只包含清单、生成的 patch 和编译后的 `lib`。`repository` 可以省略。React 使用宿主共享实例，CSS Modules 与图片使用仓库现有客户端编译器；不要把另一套 React 或宿主插件代码打入业务包。包校验是格式检查，不是代码沙箱。

<a id="business"></a>

## 修改业务

在 `workbench.json` 修改卡片文案；分类使用专家生态的统一标识：`office`、`engineering`、`design`、`content`、`data`、`education`、`lifestyle`、`general`、`uncategorized`。「我的工作台」不展示分类筛选，但包仍可携带分类。

在 `src/client/Checklist.tsx` 和相邻 CSS Module 修改业务视图，在 `locales.ts` 维护中英文案。在客户端入口声明预览图和可选 `iconUrl`；缺少图标时宿主显示默认图标。工作台注册接口见[客户端约定](../packages/actvero/capability-ui/src/contracts.ts)。业务内容占据主内容区，宿主保留公共导航与窗口控件。

示例按包名隔离浏览器本地存储，刷新后恢复清单；读取失败会显示错误并禁用修改，避免覆盖无法读取的数据。这里的存储属于当前客户端配置，不提供多项目、账户或组织隔离，也不提供备份。正式业务的数据管理需要独立设计。

<a id="limits"></a>

## 限制

本工具是仓库内开发入口，不是已经发布的通用 SDK。只接入本地 `.tgz`，不支持 ZIP 导入、平台下载、发布、自动更新、用户鉴权上下文或工作台线程绑定。专家、MCP 和 Skill 文件放入目录不会自动加载；这些能力需要后续明确的运行接口。

安装包适用于 Actvero 自有工作台注册接口。旧 DSH 工作台使用不同的注册服务，不能仅修改标识就宣称兼容。DSH 参考文档保留在[离线快照](third-party/dsh-desktop-workbenches/development-guide.zh.md)，版本为 2026-10-27；它不是当前在线规范，也不替代本文的 Actvero 包约定。
