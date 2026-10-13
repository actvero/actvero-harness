---
kind: upgrade-guide
description: "ACTVERO 桌面构建默认使用本机开发地址，各部署需要显式配置自己的平台地址。"
---
# ACTVERO 平台地址

[English](guide.md) | 中文

## 变更

`actvero/product.json` 和桌面启动回退值的默认平台地址为 `http://127.0.0.1:5194`。源码构建不再包含特定部署的服务器地址。依赖原默认值的构建必须显式配置平台。已保存的运行时地址覆盖仍优先使用。

## 迁移

1. 开发时，在运行 `pnpm run actvero:dev` 前，将 `ACTVERO_PLATFORM_URL` 设为自己的平台地址。
2. 打包部署时，在 `.actvero-builder/` 下的私有构建预设中设置 `platform.defaultUrl`，通过 `--profile` 传给[打包命令](../../../../actvero/building/README.zh.md#installer-output)。私有预设和素材不要加入 Git。
3. 首次启动时，先检查「账号与额度」设置中显示的平台地址，再登录。已安装的应用可在同一设置页面修改保存的地址。
