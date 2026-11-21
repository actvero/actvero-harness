# 构建包和规格格式

`create --spec` 读取已确认的 UTF-8 JSON。以下为虚构示例，默认素材和语言从当前源码的产品配置取值。预设中 Mac 默认生成 DMG，Windows 默认生成 EXE。

```json
{
  "id": "example-brand-0-1-0",
  "product": {
    "id": "example-brand",
    "applicationId": "com.example.harness",
    "displayName": "Example Harness",
    "version": "0.1.0",
    "defaultLocale": "zh-CN"
  },
  "platform": { "defaultUrl": "https://example.org" },
  "assistant": { "identityPrompt": "你是示例公司的办公协同助手。" },
  "targets": ["mac-arm64", "win-x64"]
}
```

- 顶层 `id` 是构建包修订 ID，用于导入和查找。产品 ID 和 applicationId 属于产品，升级时沿用。
- 素材可用 `branding.icon`、`branding.logo`、`branding.wordmark`、`branding.sidebarLogo` 和 `branding.trayIcon` 指定。相对路径以规格 JSON 所在的目录为准。提供素材后，应用图标会补上默认值，其他未提供的视觉项按打包器的产品回退规则处理。省略整个 `branding` 会复制仓库默认素材。
- 省略 `assistant` 或使用空白身份时保留产品默认身份。身份为公开文本，上限 2000 字符，会随安装包分发。平台 URL、图片和其它配置也随包公开，凭据应走用户的登录和密钥存储。
- 支持的目标为 `mac-arm64`、`mac-x64`、`win-arm64` 和 `win-x64`，每个目标声明一次。
- `create` 使用当前源码的默认插件预设和本地未签名包设置。

本地落盘位置为 `.actvero-builder/kits/<包ID>/`，Git 忽略 `.actvero-builder/`。生成后的目录或等价 ZIP 如下：

```text
manifest.json
products/example-brand/product.json
products/example-brand/icon.svg
products/example-brand/logo.svg
presets/mac-arm64.json
presets/win-x64.json
```

`manifest.json` 记录格式版本、包 ID、产品 ID、目标、两个锁文件的 SHA256、每个数据文件的 SHA256。预设引用包内的产品配置。ZIP 根目录直接放清单及资产目录。校验要求文件名可移植、没有重复或逃逸路径、没有额外文件、所有引用存在且图像能解码。单文件最多 8 MiB，一包最多 24 个文件、总计 32 MiB。只分发配置和品牌资源时，直接分享这个 ZIP。交接完整 Windows 源码与便携工具时，随现有 Windows 构建目录附上这份 ZIP，在 Windows 的本地源码副本用同一个命令加载。
