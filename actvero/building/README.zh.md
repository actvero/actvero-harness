# 可配置桌面构建

[English](README.md) | 中文

## 摘要

使用一份公开配置，构建具有独立名称、图标和默认平台地址的桌面应用。命令生成编译产物或本地未签名安装包。签名、公证、发布和更新源需要独立的发布流程。

## 目录

- [配置](#configuration)
- [命令](#commands)
- [安装包输出](#installer-output)
- [安装后的行为](#installed-behavior)
- [平台要求](#platform-requirements)
- [开发备注](#dev-note)

<a id="configuration"></a>

## 配置

默认 [product.json](../product.json) 将发行名称设为 `Actvero Harness`，稳定应用标识仍为 `com.actvero.desktop`；显示名称变更保留数据路径和系统加密身份。将 [product.example.json](../product.example.json) 复制为 `actvero/customer.json`，修改公开参数即可生成另一种发行版本。图标路径相对于所选 JSON 文件解析，且必须位于本仓库内；构建不读取同级项目。

| 字段 | 作用 |
| --- | --- |
| `product.id` | 产物目录和 `<id>-desktop://open` 返回协议；使用小写标识。 |
| `product.applicationId` | 原生应用身份和安装后数据目录；使用反向域名标识。 |
| `product.displayName` | 安装包、关于/菜单/托盘、登录页和侧栏共同使用的应用名称。 |
| `product.version` | 安装包版本；与锁定的 DSH 运行时版本独立。 |
| `product.defaultLocale` | 初始原生语言，支持 `zh-CN` 和 `en-US`；已保存的用户偏好优先。 |
| `branding.icon` | 必填的正方形 SVG/PNG，用于应用、Dock 和界面默认标志。 |
| `branding.logo` | 可选的界面/登录页标志；默认使用 `branding.icon`。 |
| `branding.trayIcon` | 可选的 Windows 托盘正方形 SVG/PNG；默认使用 `branding.icon`。 |
| `platform.defaultUrl` | 默认平台地址；远程服务要求 HTTPS，本机回环开发可使用 HTTP。 |

默认配置使用 `app-icon.svg` 作为应用、Dock 和 Windows 托盘图标：白色圆角方块搭配黑色标志。独立的 `branding.logo` 使用透明背景的 `icon.svg`，用于侧栏和登录页。

同一发行版本升级时保持 `id` 和 `applicationId` 不变。需要同时安装的不同发行版本应使用不同标识。配置中禁止放入凭据、issuer 覆盖值或私人账户数据。本地未签名包要求 `updates.enabled=false`；[产品准备](../README.zh.md#build-configuration)负责插件锁定，锁定本身不会安装所选第三方插件。

本机专用产品配置和素材可放在 `.actvero-builder/products/<id>/`，预设放在 `.actvero-builder/presets/`；Git 忽略整个目录。需要交给构建人员时单独发送这些文件。安装包仍会内嵌选定的公开默认值和素材，因此不要放入密钥。

<a id="commands"></a>

## 命令

在仓库根目录执行，先使用支持的 Node 和 pnpm 版本按锁文件安装依赖。省略 `--config` 即使用默认配置。

```sh
pnpm run actvero:check --config actvero/product.json
pnpm run actvero:build --config actvero/product.json
make package-check TARGET=mac-arm64 CONFIG=actvero/product.json
make package TARGET=mac-arm64 FORMAT=dmg CONFIG=actvero/product.json OUT=dist
```

`actvero:check` 校验公开默认值、锁文件和图标。`actvero:build` 编译完整的桌面与客户端产物。`actvero:package` 准备目标运行时，包含 ACTVERO 账户与能力模块，校验运行时完整性并生成品牌包。每个包都会检查归档中的 Main 导入，并验证包内 Host、Office 转换和 Skill CLI 发现。两个隔离的 Host 必须使用各自的默认端口同时提供前端，并通过独立退出、重启验证。`--dir` 生成解包后的测试应用；省略此参数，macOS 生成 DMG/ZIP，Windows 生成 NSIS 安装程序。这些命令不会发布或安装应用。

图标、公开元数据和安装包位于 `apps/desktop/.desktop-build/actvero/products/<id>/<fingerprint>/`；安装包在该目录下的 `artifacts/<platform>-<arch>/`。配置或图标内容改变时，指纹也会改变。每次只构建一份配置：工作区编译文件和目标运行时准备目录由各构建共用。

`actvero:package --check` 校验公开参数、图标、主机/目标、格式、导出目录及 tar/Windows C++ 工具链；不会编译或验证完整安装包。完整准备成功后，`--skip-prepare` 可复用带完整性记录的目标运行时，并重新构建桌面外壳；依赖或客户端代码发生变化时，应去掉此参数完整构建。过期或缺失的运行时会报错，不会悄悄下载其他发行版本。

可视化构建器和 Make 使用同一套本地 `Build Profile` 格式。预设引用基础产品 JSON，只保存公开覆盖项；可以通过 `PROFILE=.actvero-builder/presets/name.json make package` 或 `make package-check` 使用。显式 Make 或 CLI 参数优先于预设值，源产品 JSON 不会被改写。


### 发布基线检查

桌面当前锁定官方已发布的 `0.2.0-rc.2`（RC，不是稳定版标签），产品安装包版本与 DSH 版本独立。构建入口验证 `upstream.lock.json` 中的版本、Git 标签与提交号一致，并检查所有随包分发的 DSH 工作区版本；alpha/beta 开发基线或混合版本会在编译前失败。不要仅修改根目录版本号来跳过插件兼容性检查。

多个对话或任务应各用独立工作区，合并后重新运行 `make package-check`。依赖或客户端发生变化后执行完整构建，不复用旧的 `lib` 或 `--skip-prepare`。首次检验新基线可先执行 `pnpm run clean`；这只清理生成产物。安装包仍需验证归档运行时，以及实际页面中的悬停、键盘和菜单点击行为。

<a id="installer-output"></a>

## 安装包输出

Make 通过环境变量传递公开参数，不将它们插入 Shell 命令。`pnpm run actvero:package` 同样支持这些选项，Windows 没有 Make 时也能使用。显式 CLI 参数优先于 Make 参数；品牌覆盖值生成缓存配置，不修改所选 JSON。预设和 CLI 图标路径从仓库根目录开始解析，在所有构建主机上均支持嵌套目录；产品 JSON 中的图标路径仍相对于该 JSON。

| Make 参数 | CLI 选项 | 含义 |
| --- | --- | --- |
| `CONFIG` | `--config` | 产品 JSON，默认 `actvero/product.json`。 |
| `PROFILE` | `--profile` | 本地 Build Profile；其中的值作为所选产品 JSON 之上的默认值。 |
| `TARGET` | `--target` | `mac-arm64`、`mac-x64` 或 `win-x64`；默认当前 Node 系统/架构。 |
| `FORMAT` | `--format` | `dmg`、`zip`、`exe` 或 `all`；默认 Mac 为 DMG/ZIP，Windows 为 EXE。 |
| `OUT` | `--out` | 导出根目录，默认 `dist`，支持仓库相对路径或绝对路径。 |
| `NAME`、`VERSION` | `--name`、`--version` | 显示名称与精确产品版本；应用身份保持不变。 |
| `ICON`、`LOGO`、`TRAY_ICON` | `--icon`、`--logo`、`--tray-icon` | 应用/Dock、界面/登录页及 Windows 托盘图标。 |
| `PLATFORM_URL` | `--platform-url` | 默认平台地址。 |
| `DOWNLOAD_BASE_URL` | `--download-base-url` | HTTPS 托管根地址；链接追加产品/版本/目标/文件路径。 |
| `RELEASE_DATE` | `--release-date` | 可选的真实 `YYYY-MM-DD` 日期；不指定则留空。 |
| `NOTES` | `--notes` | UTF-8 更新说明文件，最多 256 KiB；不指定则说明为空。 |
| `MIN_SYSTEM` | `--min-system` | 操作者填写的最低系统要求，需要经过兼容验证。 |
| `DIR=1` | `--dir` | 内部解包测试应用，不能同时指定格式、输出目录或发布元数据。 |
| `SKIP_PREPARE=1` | `--skip-prepare` | 复用已验证的目标运行时。 |

内部包通过归档/运行时检查后，安装包复制到 `<OUT>/<product.id>/<product.version>/<TARGET>/`。`release.json` 记录产品/版本、构建时间、可选发布日期、更新说明、未签名状态，以及每个安装包的系统、架构、实际文件名、字节数和 SHA256。`release-info.txt` 用中文展示同样的字段，方便复制到平台表单；`build-config.json` 记录最终公开默认值，图标路径相对于原配置文件。导出拒绝已存在的目标目录，包括空目录；请选择新版本或输出根目录。导出失败会移除本次暂存目录，保留已有文件。

指定下载根地址会生成预计链接；命令不会上传文件或验证这些链接。未填写的链接、发布日期和最低系统要求保持 null；构建时间与发布日期分开记录。推荐版本由平台发布操作选择。平台目前仍需手工填写；生成 JSON 不等于增加平台导入接口。后续签名或修改安装包后，需要重新计算大小与 SHA256。

```sh
make package TARGET=mac-arm64 FORMAT=dmg OUT=dist \
  NAME="Actvero Harness" VERSION=0.1.0 ICON=actvero/app-icon.svg \
  LOGO=actvero/icon.svg TRAY_ICON=actvero/app-icon.svg \
  PLATFORM_URL=https://platform.example.com \
  DOWNLOAD_BASE_URL=https://downloads.example.com/desktop
```

Windows 打包在符合要求的 Windows 主机上执行，沿用同一份 JSON 和 `--target win-x64 --format exe --out dist`。Windows ARM 使用 x64 Node 时可能满足进程架构选择，但原生构建工具及完整安装/运行时仍需 Windows 验收；原生 ARM64 Node 会被 `win-x64` 拒绝。

<a id="installed-behavior"></a>

## 安装后的行为

用户保存的平台地址优先于构建默认值，并在升级后保留。更改地址继续正常登录流程，身份服务由该平台发现。连接后，登录页、浏览器确认页和侧栏继续使用构建配置中的名称与标志；仅未提供产品品牌时才使用平台公开品牌。原生身份、Dock/托盘图标、返回协议和数据路径仍由构建配置管理。ACTVERO 默认标志在浅色表面为黑色、深色表面为白色。界面中的 SVG 保留主题规则；登录页的浅色背景区域使用浅色版本。原生图标单独栅格化生成。

安装后的用户数据位于 Electron 应用数据目录下的 `<applicationId>/`，DSH 配置默认放入其 `dsh/` 子目录。显式设置 `DSH_HOME` 时保留其原有含义。账户开发命令继续使用独立的开发配置。浏览器返回链接使用所选发行版本的协议，不占用官方应用的 `dsh` 协议。

系统加密使用固定的 `product.applicationId`；`displayName` 只影响可见品牌。修改显示名称不会改变钥匙串命名空间。早期 ACTVERO 开发配置曾使用包名或显示名称进行加密，需要显式迁移加密文件；应用不会导入旧桌面的凭据，也不会清空无法读取的文件。

<a id="platform-requirements"></a>

## 平台要求

目标支持 `mac-arm64`、`mac-x64` 和 `win-x64`。macOS 目标要求 macOS 主机；`win-x64` 要求 Windows x64 主机。Electron 可以跨平台打包部分应用，但本仓库需要准备原生依赖并执行目标运行时检查。不能绕过这些检查后宣称已在 macOS 完成 Windows 产物。

Windows 交付应在 Windows CI 中使用相同配置。Mac 可以发起该 CI 任务，编译与安装包验证在 Windows 上完成。本次本地实现在 macOS ARM64 验证；Windows 安装、托盘和运行时验收由 Windows 执行环境负责。

PowerShell 命令、产物核验和安装后的应用验收见 [Windows 安装包教程](windows.zh.md)。

<a id="dev-note"></a>

## 开发备注

本机 macOS ARM64 构建已生成未签名 DMG/ZIP，并通过归档及运行时检查。品牌相关测试和仓库类型检查通过。仓库全量代码及文档检查仍报告现有 ACTVERO 能力模块的格式、契约文档和生成目录问题；签名发布及 Windows 验收尚未验证。
