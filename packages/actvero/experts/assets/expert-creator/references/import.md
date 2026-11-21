# 交付专家文件与隔离试导入

给需要把专家交给另一台 Harness 的 Agent 使用。命令均从本 Skill 根目录执行。打包用 Python 3 标准库，试导入用 Node.js 和目标 Harness 随附的导入器。可以在同台机器上复制整个 Skill 目录运行，无需安装 npm 包。

## 先选文件形态

| 交付目标 | 桌面「能力中心 → 专家 → 导入专家」接受的文件 | 需要验证的结果 |
| --- | --- | --- |
| 只带专家清单，依赖由接收人绑定 | 裸 `expert.json`，根对象直接是 manifest，含稳定 `id` | 成功导入并回读。仍有必需依赖时，单列待绑定项 |
| 一次带走专家、本地多文件 Skill、MCP 模板或平台引用 | 一个 `actvero-expert` v1 的 ZIP | 预览每项依赖状态，确认隔离导入、回读、再查就绪情况 |
| 在指定设备就地保存或改造 | 原生 `expert_create/update` 或桌面 CLI 请求 | 按[工具手册](tools.md)保存、回读。新建时 CLI 请求外层含 `expert`，原生工具直接接收名称、提示词、依赖 ID 和可选头像路径 |

## 准备 ZIP 的输入目录

```text
release-notes/
├── expert.json
├── dependencies.json
├── skills/release-brief/
│   ├── SKILL.md
│   └── assets/brief.md
└── connectors/github-repos.json
```

可复制的组成文件见[专家清单](../examples/release-notes/package/expert.json)、[依赖清单](../examples/release-notes/package/dependencies.json)、[Skill 入口模板](../examples/release-notes/package/skills/release-brief/SKILL.md.in)和[连接模板](../examples/release-notes/package/connectors/github-repos.json)。本 Skill 自身只保留一个可发现的 SKILL.md，因此示例入口带 .in，制作时复制为 SKILL.md。

- 清单使用 `schemaVersion: 1`，有稳定的 `id`、三段数字 `version`、`name`、`description` 和 `instructions`。同一专家发新版沿用来源 ID 并提高版本。技能和连接的 key 在各自列表内唯一；技能声明 `required` 和 `load`，连接声明 `required`。
- `dependencies.json` 带 `schemaVersion: 1`、`skills`、`connectors`。本地依赖按对应 key 指到 `skills/…` 目录或 `connectors/…json` 文件，每个 Skill 目录含一个有效的 SKILL.md 和全部被引用的资源。
- 平台依赖写入目录核实的 `source: "platform"`、`platform`、`id`、`sha256`，平台 Skill 还需 `versionId`。目标组织的授权单独验证。MCP 模板只携带可移植配置和空凭据字段。导入后的本地连接从停用状态开始。
- [打包脚本](../scripts/pack-expert.py)按文件原始字节生成顶层 `package.json`，列出每个成员的路径、大小和 SHA-256。输入用专门准备的交付目录，输出放在目录外。使用新的 ZIP 路径，便于区分每一次验收。

## 跑通自带样例

macOS / Linux 终端中运行以下命令。临时输出路径由第一行创建，最后的 ZIP 就是可以交给用户的专家包。Windows 使用相同的目录结构，用文件管理器复制并重命名入口，再用 Python 与 Node 运行最后两条命令。

```sh
trial_dir="$(mktemp -d)"
cp -R examples/release-notes/package "$trial_dir/source"
mv "$trial_dir/source/skills/release-brief/SKILL.md.in" "$trial_dir/source/skills/release-brief/SKILL.md"
python3 scripts/pack-expert.py "$trial_dir/source" "$trial_dir/release-notes.zip"
node scripts/check-import.mjs "$trial_dir/release-notes.zip"
```

已有 ZIP 时直接运行最后一条。裸清单也可以单独试。非标准安装路径或 Windows 用 `--desktop` 指定应用的可执行文件。维护者可传 `--workspace <已构建的 Harness 仓库>` 以仓库构建产物复测。访问不到受测运行时时，记录运行环境和缺项。

```sh
node scripts/check-import.mjs examples/release-notes/package/expert.json
node scripts/check-import.mjs ./expert.zip --desktop "/path/to/HarnessExecutable"
```

## 读懂验证结果

[验证脚本](../scripts/check-import.mjs)创建全新的临时存储，ZIP 走桌面的包预览、导入和回读，裸 JSON 走清单校验及导入。脚本最后检查依赖，释放临时目录。隔离环境没有账号、平台授权、既有同名专家或已连接的 MCP。将目标 Profile 的实际冲突、授权、业务表现留给各自的验收步骤。

| 退出码 / status | 如何处理 |
| --- | --- |
| 0 / imported | 抄录 `runtime.version`、`expert.version`、`expert.revision`。用 `expert.hasAvatar` 核对自带图片或默认头像，另看 `dependencies.ready`、`warnings` 和 `missing`。样例 ZIP 的本地 Skill 和连接模板应能导入，GitHub 业务方法仍待授权。样例裸 JSON 的必需 Skill 仍待绑定 |
| 1 / rejected | 看 `stage` 和 `error`。例如 `expert_package_checksum` 要用修改后的原文件重新打包；`invalid_skill` 查 Skill 元数据；`expert_invalid` 查字段、ID、版本和文件外层。修复后对新产物重跑 |
| 2 / blocked | 格式已走到预览，但当前环境无法提交。看 `preview.rows` 找有问题的 key 和状态，确认目标环境具备所需依赖或授权后再验证 |
| 3 / error | 脚本、文件读取或运行时条件异常。根据阶段排查 Node、可执行文件、路径、运行时兼容性或存储，再执行同一测试 |

向用户交付最后实际测过的文件，附一条业务样例。跨版本升级还应在含旧版的测试环境走一次更新预览，核对旧数据、依赖冲突和目标版本。重复运行本脚本每次都从空环境开始。

要检验作者工具本身，可运行下面的[回归脚本](../evals/test-import.py)。它会构造独立样例，检查含多文件 Skill 与可选 MCP 的 ZIP、裸清单、默认头像和提供的 PNG、误用 CLI 请求、摘要损坏、无效 Skill、未声明的依赖、含非空凭据的模板、必需平台授权缺失。对自己制作的专家，请另外用 check-import.mjs 检查实际交付物。

```sh
python3 evals/test-import.py
```
