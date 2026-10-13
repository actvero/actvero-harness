# Build a Windows installer

English | [中文](windows.zh.md)

## Summary

This tutorial produces an unsigned Windows x64 installer from the current checkout, verifies its exported bytes and describes installation acceptance. Product settings and packaging options are defined in the [build reference](README.md).

## Table of Contents

- [1. Prepare the build host](#prepare)
- [2. Install and check](#check)
- [3. Package and verify](#package)
- [4. Test the installed application](#acceptance)
- [Troubleshooting](#troubleshooting)
- [Dev Note](#dev-note)

<a id="prepare"></a>

## 1. Prepare the build host

Use a Windows x64 machine with native PowerShell, Git, x64 Node and the pnpm version specified by the root [package.json](../../package.json). Install Visual Studio C++ build tools with the x86/x64 component and make `tar` available on PATH. The package preflight checks tar archive creation and listing and locates the C++ tools through `vswhere.exe`. Dependency and runtime downloads require network access.

Place the checkout at a short physical path such as `C:\src\actvero-harness`. Keep the release tag recorded in [upstream.lock.json](../upstream.lock.json) available locally; the baseline check resolves that tag to its pinned commit. Install dependencies in this checkout on Windows. Do not reuse another checkout's `node_modules`, `lib` or prepared desktop runtime, or run this sequence inside WSL.

Open PowerShell at the repository root. Use this helper in the same session so a failed native command stops the sequence:

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

Record the source commit, any local changes and the command output with the build results. Node must report `win32 x64`. Use one packaging process per checkout.

<a id="check"></a>

## 2. Install and check

The following commands use the public defaults in [product.json](../product.json). For another deployment, use a [private build profile](README.md#configuration) with your platform address and artwork; keep its values consistent between preflight and packaging.

```powershell
Invoke-Checked -Command pnpm -Arguments @('install', '--frozen-lockfile')
Invoke-Checked -Command pnpm -Arguments @('run', 'actvero:check', '--config', 'actvero/product.json')
$packageArgs = @('run', 'actvero:package', '--target', 'win-x64', '--format', 'exe', '--config', 'actvero/product.json', '--out', 'dist')
Invoke-Checked -Command pnpm -Arguments ($packageArgs + @('--check'))
```

Preflight validates the selected inputs and host tools; it does not create an installer. After switching DSH baselines, preserve any needed internal installers and run `pnpm run clean` through the helper before packaging. Cleaning removes generated outputs, including the internal desktop build directory.

<a id="package"></a>

## 3. Package and verify

```powershell
Invoke-Checked -Command pnpm -Arguments $packageArgs
```

The command prepares the runtime, builds the desktop, creates an NSIS installer and checks the archived Main imports and packaged runtime. Require a zero exit code, the `ACTVERO package: verified archived runtime` message and the final exported path. It neither installs nor publishes the application. Use the complete command after source or dependency changes; do not add `--skip-prepare` to recover from a failed build.

For the default configuration and `--out dist`, verify the actual exported installer against `release.json`:

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

The [installer output reference](README.md#installer-output) defines the exported files and metadata. If an output directory already exists, choose a new output root or product version and use it in both the build and verification commands. Do not substitute a cached installer from an earlier run. Keep the installer, release metadata, source commit, build-host versions and test results together.

<a id="acceptance"></a>

## 4. Test the installed application

Install the exact verified EXE in a Windows test account or disposable test machine. Preserve existing user data; use a fresh test account for first-launch checks. Follow [installed behavior](README.md#installed-behavior) for application identity and data locations. Record the Windows version and mark each untested scenario explicitly.

| Area | Acceptance |
| --- | --- |
| Installer and shell | Install and start the intended version; check the application name, Chinese default locale, tray icon, close/restore and explicit exit. |
| Platform account | Enter your platform address, complete browser login, select an organization when required, restart and confirm the restored account, then sign out. |
| Models and quota | With a test account, run a platform model task and verify the account/quota display against that platform. |
| Local workspace | Enter local mode, open a workspace, run a configured model task and inspect generated files and Office previews. |
| Experts and connectors | Import a test expert package, invoke it repeatedly and verify required Skills and MCP tools; configure each external CLI and authorization in the Windows test account. |
| UI and upgrade | Check light/dark themes, window resizing, menus and keyboard use; test an upgrade with disposable sample settings and conversations. |

Successful packaging or CI completion does not establish real-account, installer or UI acceptance. Record those results separately. The package remains unsigned; signing and publication use a separate release process.

<a id="troubleshooting"></a>

## Troubleshooting

| Failure | Action |
| --- | --- |
| Host or architecture rejected | Use native Windows with x64 Node; macOS, WSL and native ARM64 Node do not satisfy this target. |
| `tar` or `vswhere` preflight fails | Install the reported tool or C++ component, reopen PowerShell and rerun preflight. |
| Baseline tag missing or mismatched | Restore the exact pinned upstream tag and matching source baseline; do not edit version labels to bypass the check. |
| Runtime download fails | Check access to the URL in the error and retain its log; rerun the full command after connectivity is restored. |
| Archive/runtime verification fails | Keep the failing stage's log and inspect the current build; do not copy generated files from another machine or deliver an older EXE. |

<a id="dev-note"></a>

## Dev Note

The [build entry](../../scripts/actvero-build.ts), [toolchain preflight](../../apps/desktop/scripts/desktop-toolchain-preflight.ts) and [archived-runtime checks](../../scripts/actvero-smoke.ts) own the executable behavior. Windows installation and interactive acceptance require a Windows environment; a macOS run cannot provide that evidence.
