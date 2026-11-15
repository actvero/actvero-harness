# 工作台 npm 开发套件

[English](workbench-npm.md) | 中文

面向使用已安装 ACTVERO 桌面端的工作台开发者与 Agent。此包提供脚手架、固定版本的编译工具、接口声明和两份 Skill；开发不需要 Harness 源码。当前预览包支持 macOS Apple Silicon，需要 Node 22.19 或 24 及以上版本；其他系统与架构不在本次发行范围内。

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

新建项目已自动携带两份 Skill。需要共享或指定 Agent 目录时运行下面一条命令；同名 Skill 已存在会拒绝覆盖，更新前先备份并移走旧目录。

```sh
actvero-workbench skills install --global
actvero-workbench skills install "$HOME/.codex/skills"
```

`--global` 写入 `~/.agents/skills/`；不带路径时写入当前目录的 `.agents/skills/`。不同 Agent 的发现规则不同，复制文件不代表所有 Agent 都已加载；必要时直接提供输出目录中的 SKILL.md 路径，或在该 Agent 中重新加载技能。ACTVERO 桌面端自带的技能由桌面版本管理。

## 更新、调试与交付

升级 npm 套件后，对已有项目执行 `actvero-workbench bind /绝对路径/项目`，刷新工具链绑定、Skill 和类型配置，保留业务源码与 DESIGN.md。不要把旧缓存路径复制到另一台机器；在目标机器安装匹配套件后重新 bind。

`npm run dev` 监听项目并重新检查、打包；它不自动安装、重载或启动桌面端。通过 `.actvero/diagnostics.json` 查看本次构建结果，再在目标桌面端导入并验证真实业务。安装成功、视图加载与业务验收分别记录。

卸载全局 npm 包不会删除项目、已复制的 Skill 或缓存；仍被项目绑定的缓存需要保留。可用 info 获取缓存位置，在项目迁移到新版套件后再清理不用的旧目录。此套件不自动上传、发布或调用付费模型。

## 维护者打包

在已完成 build 的源码目录运行 `pnpm run actvero:workbench-npm /绝对路径/新发行目录`。包名、版本与 dist-tag 来自 actvero/workbench-npm.json；命令只生成发行目录，不上传。使用 npm pack 检查文件清单，并从实际 npm 归档安装到隔离前缀完成创建、编译、打包与 Skill 安装验证后再发布。
