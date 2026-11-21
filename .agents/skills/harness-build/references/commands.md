# 构建包命令

在 Actvero Harness 源码根目录执行。用当前仓库的锁定 pnpm，快捷入口统一为 `pnpm run actvero:build-kit --`。成功最后一行是 JSON，错误走 stderr 且返回非零。构建实时日志走 stderr，也写到 `.actvero-builder/logs/`。

| 子命令 | 输入和成功结果 |
| --- | --- |
| `list` | 列出默认、传统本地预设和构建包预设。JSON 含 `host`、`presets`、`errors`。按 `compatible` 判断目前 Node 的平台和架构是否匹配。 |
| `create --spec <规格JSON>` | 校验规格和素材后装入本地，返回 `id`、`path`、`status`。 |
| `validate <目录或ZIP>` | 只读检测清单、锁文件、图片、目标和引用。成功返回 `status=valid`，附带 ID、目标和路径。 |
| `import <目录或ZIP>` | 校验后写入本机。已有同 ID、同字节的包返回 `already-present`，首次装入返回 `installed`。同 ID 内容不同时失败并保留原包。 |
| `export --id <包ID> --out <ZIP>` | 用已装入的构建包重新校验并导出 ZIP，返回路径。目标已存在时失败。 |
| `build --preset <完整预设ID> [--out <目录>] [--check] [--allow-dirty]` | 先预检后构建。省略输出时自动创建独立结果目录。仅查预检时返回 `preflight-passed`，完整打包并校验成功返回 `built` 和安装包、日志、源码提交等信息。 |

```sh
pnpm run actvero:build-kit -- list
pnpm run actvero:build-kit -- create --spec ./.agents/skills/harness-build/examples/example-brand.json
pnpm run actvero:build-kit -- export --id example-brand-0-1-0 --out ./.actvero-builder/exports/example-brand.zip
pnpm run actvero:build-kit -- validate ./.actvero-builder/exports/example-brand.zip
pnpm run actvero:build-kit -- import ./.actvero-builder/exports/example-brand.zip
pnpm run actvero:build-kit -- build --preset kit:example-brand-0-1-0/mac-arm64 --check
pnpm run actvero:build-kit -- build --preset kit:example-brand-0-1-0/mac-arm64
```

把路径中含空格的参数作为一个引号包起的参数传递。构建预设 ID 使用 `list` 中的全名，例如 `default:mac-arm64`、`local:xtd-win-x64` 或 `kit:example-brand-0-1-0/win-x64`。

校验失败时报告文件和缺失字段。锁文件不匹配时用相容源码或由用户确认后重新生成包。预设或输出冲突时选择明确的新 ID 或新目录。预检失败后从日志修复对应依赖或平台要求。构建过程中保留已有文件，继续使用正式打包路径。
