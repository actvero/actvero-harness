# 工作台 npm 开发套件

[English](workbench-npm.md) | 中文

面向使用已安装 ACTVERO 桌面端的工作台开发者与 Agent。此包提供脚手架、固定版本的编译工具、接口声明、联调命令及三份共享 Skill：develop-workbench、workbench-frontend 和 expert-creator；开发不需要 Harness 源码。当前预览包支持 macOS Apple Silicon，需要 Node 22.19 或 24 及以上版本；其他系统与架构不在本次发行范围内。

## 安装与创建

```sh
npm install -g @actvero/workbench-development-kit@preview
actvero-workbench --version
actvero-workbench info
actvero-workbench create ./my-workbench @local/my-workbench
cd ./my-workbench
npm run doctor
npm run typecheck
npm run build
npm run check
```

生成后先读项目 AGENTS.md、DESIGN.md 和 .agents/skills/develop-workbench/SKILL.md，再按已确认的业务需求实现。create 默认是空白模板；末尾加 `--template plain` 或 `--template ai` 可查看示例。dist/*.tgz 是导入桌面端的业务包，不是本 npm 开发套件。

首次需要编译器的命令会校验并解压包内 kit.tgz 到 `~/.cache/actvero-workbench/`；不会下载第二份工具链，也不执行安装后脚本。info 返回实际目录、DSH 基线与工作台 API 版本。可用 `ACTVERO_WORKBENCH_CACHE_DIR` 指定缓存父目录。npm 安装的版本与运行中的桌面端仍需满足各自兼容性要求。

## 为 Agent 安装 Skill

新建项目携带工作台开发和前端两份 Skill。共享安装同时提供专家创建 Skill。使用下面一条命令安装到共享目录或指定 Agent 目录；同名 Skill 已存在时拒绝覆盖。升级套件后使用 `actvero-workbench skills update --global`，仅替换本工具管理且未被修改的副本，保留用户自己的文件。

```sh
actvero-workbench skills install --global
actvero-workbench skills install "$HOME/.codex/skills"
```

`--global` 写入 `~/.agents/skills/`；不带路径时写入当前目录的 `.agents/skills/`。不同 Agent 的发现规则不同，复制文件不代表所有 Agent 都已加载；必要时直接提供输出目录中的 SKILL.md 路径，或在该 Agent 中重新加载技能。ACTVERO 桌面端自带的技能由桌面版本管理。

<a id="local-capabilities"></a>

## 管理本机 Skill 和 MCP

在 Harness 对话中，直接请 AI 安装或编辑指定的 Skill 或 MCP。AI 使用内置的 `local_capabilities` 工具，写入和连接测试走当前会话的工具授权。外部 Agent 使用同一组命令，从目标 Harness 的「交给其他 Agent」取得开发连接文件。

```sh
actvero-workbench skill list --connection /absolute/path/connection.json
actvero-workbench skill install /absolute/path/skill.zip --connection /absolute/path/connection.json
actvero-workbench mcp create --connection /absolute/path/connection.json --file ./mcp-create.json
```

`skill install` 接受目录、ZIP 或 SKILL.md。先用 `skill show` 的请求 `{"id":"本机 Skill ID"}` 获取版本和文件清单。用 `skill read` 读取指定文本文件，传 `id` 和包内 `path`。用 `skill edit` 更新一个现有文本文件，传 `id`、`version`、包内 `path` 和完整 `content`。需要替换整个包时用 `skill update`，将 `path` 指向新包的绝对路径。更新保留 Skill ID 和旧版本，过期的版本拒绝写入。`skill enable` 接受 `id` 和 `enabled`。

MCP 创建请求是 `{"config":{"name":"文档服务","transport":"http","url":"https://example.org/mcp"}}`，也支持 stdio 和 SSE。新建配置默认停用。用 `mcp show` 获取 `revision`，再用 `mcp update` 提交 `id`、`revision` 和只包含变更字段的 `patch`。已启用的连接更新后重新连接。`mcp test` 使用 `id` 测试并关闭临时连接，`mcp enable` 使用 `id` 和 `enabled` 保存启停状态。凭据在 Harness 的连接器页面输入，CLI 返回的摘要省略凭据、启动参数和完整 URL。带凭据的连接更换执行程序或地址时，请在连接器页面核对并编辑。

`skill help` 和 `mcp help` 列出当前命令。写入超时或被中断时，先用 list 或 show 查询实际状态再重试。目录发现的 Skill 通过其原目录编辑，`skill` 命令管理 Harness 安装的本机包。

## 更新、调试与交付

升级 npm 套件后，对已有项目执行 `actvero-workbench bind /绝对路径/项目`，刷新工具链绑定、Skill 和类型配置，保留业务源码与 DESIGN.md。不要把旧缓存路径复制到另一台机器；在目标机器安装匹配套件后重新 bind。

`npm run dev` 自动构建。先运行 `actvero-workbench attach /项目目录 --connection /连接文件`，即可在目标 Harness 中加载临时开发覆盖；未连接时仅构建。通过 status、logs 和 detach 检查或结束覆盖。构建、加载与业务验收参见[开发指南](workbench-development.zh.md#create)。

卸载全局 npm 包不会删除项目、已复制的 Skill 或缓存；仍被项目绑定的缓存需要保留。可用 info 获取缓存位置，在项目迁移到新版套件后再清理不用的旧目录。此套件不自动上传、发布或调用付费模型。

## 维护者打包

在已完成 build 的源码目录运行 `pnpm run actvero:workbench-npm /绝对路径/新发行目录`。包名、版本与 dist-tag 来自 actvero/workbench-npm.json；命令只生成发行目录，不上传。使用 npm pack 检查文件清单，并从实际 npm 归档安装到隔离前缀完成创建、编译、打包与 Skill 安装验证后再发布。
