---
kind: upgrade-guide
description: "早期 ACTVERO 桌面构建需要将加密数据从显示名称对应的钥匙串身份迁移到固定的 applicationId。"
---
# ACTVERO 加密存储身份

[English](guide.md) | 中文

## 变更

ACTVERO 构建使用 `product.applicationId` 作为 Electron 的系统加密身份。`product.displayName` 仍用于可见品牌，不再选择钥匙串命名空间。官方 DSH 构建不受影响。在 macOS 上，早期 ACTVERO 构建使用包名或显示名称加密的文件，需要迁移后才能由新身份读取。用户数据路径和文件格式不变。

## 迁移

1. 保持 `actvero/product.json` 或所选构建配置中的 `product.id` 和 `product.applicationId` 不变。替换早期构建前，停止应用并私密备份其 Electron 用户数据目录，包括 `actvero-device-account.enc` 和 `actvero-capabilities/`。保留原来的系统钥匙串条目。
2. 对受影响的开发配置，由维护者显式使用该配置原应用的密钥解密已知文件，再由新 `applicationId` 下的 Electron safeStorage 重新加密。先保留原始密文；明文只留在内存。不要清空 MCP 配置、复制其他应用的凭据或删除钥匙串条目来绕过错误。这是显式迁移，不是自动导入旧桌面的配置。
3. 启动同一配置。确认已保存的账户和组织，打开「我的 MCP」并召唤本地专家。修改显示名称后，这些配置必须仍然保留。无法迁移时，保留原始加密文件和旧构建，直到可以恢复；重新登录不会恢复本机 MCP 凭据。
