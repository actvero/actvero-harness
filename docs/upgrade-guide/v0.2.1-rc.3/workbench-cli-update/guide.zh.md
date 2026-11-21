---
kind: upgrade-guide
description: 内置工作台 CLI 将监听式开发挂载改为一次安装一个版本。
---

# 用一条命令更新本机工作台

[English](guide.md) | 中文

## 变更

Actvero Harness 的内置 CLI 使用 `update` 一次应用一个版本。已有工作台保留包名，每次更新提高版本。`attach`、`dev`、`logs` 和 `detach` 已移除。`status` 改用包名和连接文件。

## 迁移

1. 从目标 Harness 重新取得连接文件。对已有项目运行 `bind` 刷新随项目分发的指南。
2. 开发和自测完成后，运行 `actvero-workbench update <项目目录> --connection <连接文件> --json`。将自动化中对旧监听命令的调用改为这条命令。
3. 用 `actvero-workbench status <包名> --connection <连接文件> --json` 核对安装版本，再打开工作台验证新版。
