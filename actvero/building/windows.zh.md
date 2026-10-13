# 构建 Windows 安装包

[English](windows.md) | 中文

## 概述

本教程从当前检出的代码生成未签名 Windows x64 安装包，核对导出文件，并说明安装后的验收步骤。产品配置和打包选项由[构建参考](README.zh.md)定义。

## 目录

- [1. 准备构建主机](#prepare)
- [2. 安装依赖并检查](#check)
- [3. 打包并核验](#package)
- [4. 验收安装后的应用](#acceptance)
- [故障排查](#troubleshooting)
- [开发备注](#dev-note)

<a id="prepare"></a>

## 1. 准备构建主机

使用 Windows x64 主机、原生 PowerShell、Git、x64 Node，以及根目录 [package.json](../../package.json) 指定的 pnpm 版本。安装带有 x86/x64 组件的 Visual Studio C++ 构建工具，并确保 PATH 中可以找到 `tar`。打包预检会实际检查 tar 创建和列出归档内容的行为，并通过 `vswhere.exe` 定位 C++ 工具。下载依赖和运行时需要网络连接。

将仓库放在较短的实际路径，例如 `C:\src\actvero-harness`。本地需保留 [upstream.lock.json](../upstream.lock.json) 指定的发布标签；基线检查会将该标签解析到锁定的提交。在当前 Windows 工作区安装依赖，不复用其他工作区的 `node_modules`、`lib` 或已准备的桌面运行时，也不在 WSL 中执行本教程。

在仓库根目录打开 PowerShell。在同一会话中定义并使用下列辅助函数，让原生命令失败时停止执行：

```powershell
Set-Location 'C:\src\actvero-harness'
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}
Invoke-Checked -Command git -Arguments @('rev-parse', 'HEAD')
Invoke-Checked -Command git -Arguments @('status', '--short')
Invoke-Checked -Command node -Arguments @('-p', 'process.version + " " + process.platform + " " + process.arch')
Invoke-Checked -Command pnpm -Arguments @('--version')
```

将源代码提交号、本地改动和命令输出随构建结果保存。Node 必须显示 `win32 x64`。同一工作区每次只运行一个打包进程。

<a id="check"></a>

## 2. 安装依赖并检查

以下命令使用 [product.json](../product.json) 中的公开默认配置。连接其他部署时，使用包含平台地址和图片的[私有构建预设](README.zh.md#configuration)，并确保预检和正式打包使用相同的值。

```powershell
Invoke-Checked -Command pnpm -Arguments @('install', '--frozen-lockfile')
Invoke-Checked -Command pnpm -Arguments @('run', 'actvero:check', '--config', 'actvero/product.json')
$packageArgs = @('run', 'actvero:package', '--target', 'win-x64', '--format', 'exe', '--config', 'actvero/product.json', '--out', 'dist')
Invoke-Checked -Command pnpm -Arguments ($packageArgs + @('--check'))
```

预检验证所选输入和主机工具，不生成安装包。切换 DSH 基线后，先保存需要保留的内部安装包，再通过辅助函数执行 `pnpm run clean`，然后打包。清理会移除生成产物，包括内部桌面构建目录。

<a id="package"></a>

## 3. 打包并核验

```powershell
Invoke-Checked -Command pnpm -Arguments $packageArgs
```

该命令准备运行时、构建桌面、生成 NSIS 安装包，并检查归档中的 Main 导入及随包运行时。必须确认退出码为零、日志包含 `ACTVERO package: verified archived runtime`，且输出最终导出路径。命令不会安装或发布应用。源码或依赖变化后执行完整命令，不添加 `--skip-prepare` 来绕过失败的构建。

使用默认配置和 `--out dist` 时，按 `release.json` 核对实际导出的安装包：

```powershell
$product = (Get-Content 'actvero/product.json' -Raw | ConvertFrom-Json).product
$releaseDir = Join-Path 'dist' "$($product.id)/$($product.version)/win-x64"
$release = Get-Content (Join-Path $releaseDir 'release.json') -Raw | ConvertFrom-Json
foreach ($artifact in $release.artifacts) {
  $installer = Get-Item (Join-Path $releaseDir $artifact.file_name)
  $hash = Get-FileHash $installer.FullName -Algorithm SHA256
  if ($installer.Length -ne $artifact.file_size -or $hash.Hash -ne $artifact.sha256) {
    throw "Installer size or SHA256 differs from release.json: $($installer.FullName)"
  }
  $installer | Select-Object FullName, Length
  $hash | Select-Object Hash
}
```

[安装包输出参考](README.zh.md#installer-output)定义导出文件与元数据。如果目标目录已存在，选择新的输出根目录或产品版本，并同步修改构建和核验命令。不要用先前缓存的安装包替代本次产物。将安装包、发布元数据、源代码提交号、构建环境版本及测试结果一起保留。

<a id="acceptance"></a>

## 4. 验收安装后的应用

在 Windows 测试账户或可丢弃的测试机器中，安装刚刚核验的 EXE。保留现有用户数据，使用新测试账户检查首次启动。应用身份和数据位置见[安装后的行为](README.zh.md#installed-behavior)。记录 Windows 版本，并明确标记未测试的场景。

| 范围 | 验收内容 |
| --- | --- |
| 安装与桌面外壳 | 安装并启动预期版本，检查应用名称、默认中文、托盘图标、关闭与恢复窗口，以及显式退出。 |
| 平台账户 | 输入自己的平台地址，完成浏览器登录，按需选择组织，重启后确认恢复的账户，再退出登录。 |
| 模型与额度 | 使用测试账户执行一次平台模型任务，并对照平台核验账户与额度显示。 |
| 本地工作区 | 进入本地模式，打开工作区，使用已配置的模型执行任务，检查生成文件与 Office 预览。 |
| 专家与连接器 | 导入测试专家包，重复调用并验证所需 Skills 和 MCP 工具；在 Windows 测试账户中配置各外部 CLI 及授权。 |
| 界面与升级 | 检查浅色/深色主题、窗口缩放、菜单和键盘操作；使用可丢弃的示例设置与会话测试升级。 |

打包成功或 CI 完成不代表真实账户、安装或界面验收通过，应分别记录结果。安装包仍未签名；签名和发布使用独立的发布流程。

<a id="troubleshooting"></a>

## 故障排查

| 失败情况 | 处理方式 |
| --- | --- |
| 主机或架构被拒绝 | 使用原生 Windows 和 x64 Node；macOS、WSL 和原生 ARM64 Node 不满足此目标要求。 |
| `tar` 或 `vswhere` 预检失败 | 安装报错指出的工具或 C++ 组件，重新打开 PowerShell，再执行预检。 |
| 基线标签缺失或不匹配 | 恢复锁定的上游标签及对应源码基线，不修改版本号来绕过检查。 |
| 运行时下载失败 | 检查能否访问报错中的地址并保留日志；网络恢复后重新执行完整命令。 |
| 归档或运行时检查失败 | 保留失败阶段日志并检查本次构建，不从其他机器复制生成文件，也不交付旧 EXE。 |

<a id="dev-note"></a>

## 开发备注

[构建入口](../../scripts/actvero-build.ts)、[工具链预检](../../apps/desktop/scripts/desktop-toolchain-preflight.ts)和[归档运行时检查](../../scripts/actvero-smoke.ts)定义实际执行行为。Windows 安装和交互验收需要 Windows 环境，macOS 执行结果不能作为这些项目的验证证据。
