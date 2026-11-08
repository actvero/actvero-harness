---
kind: upgrade-guide
description: "ACTVERO 工作台默认创建空白项目，打包前必须通过类型检查。"
---
# ACTVERO 工作台项目初始化

[English](guide.md) | 中文

## 变更

`actvero:workbench create` 默认创建空白界面，同时提供项目命令、DESIGN.md，以及独立的开发和前端 Skill。省略包名时生成本地身份并保存到 package.json。`pack` 现在先检查 TypeScript，再生成归档，因此需要当前源码工具链的类型构建产物。类型检查失败保留原产物。

## 迁移

需要清单示例时显式使用 `--template plain`，AI 示例使用 `--template ai`。已有包名和业务数据无需迁移。检查或打包工作台前，先在源码仓库执行 `pnpm run build:artifacts`。修复报告的作者类型错误，不把转译成功当作校验通过。

新项目在自身目录运行 `npm run doctor`、`npm run typecheck`、`npm run build` 和 `npm run check`。源码仓库移动或换机器后，执行 `node scripts/workbench.mjs bind <源码根目录>` 刷新本机配置与指导资料。已有项目可继续使用仓库命令。业务设计、安装和实际验收见[开发指南](../../../../actvero/workbench-development.zh.md#create)。
