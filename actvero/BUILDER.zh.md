# Actvero Harness Builder

[English](BUILDER.md) | 中文

`make builder` 为现有 ACTVERO 打包命令启动仅监听回环地址的浏览器界面。也可使用显式命令 `make actvero-builder` 和 `pnpm run actvero:builder`。表单将本地预设和上传的图片写入 `.actvero-builder/`；Git 忽略该目录，发布产物不包含这个目录。

构建器提供仓库已支持的打包目标：`win-x64`、`mac-arm64` 和 `mac-x64`。界面不提供 `win-arm64`，因为桌面运行时和打包目标尚未完成该架构的验证。

页面支持保存预设、检查配置、启动打包和实时查看子进程输出。打包委托给 `pnpm run actvero:package`，因此命令行和可视化构建使用相同的产品配置、运行时准备、冒烟检查、输出目录与发布元数据。

保存的预设使用共享 `Build Profile` 格式。预设引用基础产品文件，只保存产品身份、平台、品牌和打包输出的公开覆盖项。不使用浏览器时也能使用同一预设：

```bash
make package PROFILE=.actvero-builder/presets/my-profile.json
make package-check PROFILE=.actvero-builder/presets/my-profile.json
```

命令行参数仍然优先于预设值。预设不包含凭据，原始 `actvero/product.json` 不会被改写。

请在仓库根目录运行命令。服务仅绑定 `127.0.0.1`，并输出随机分配的访问地址。使用 `ARGS="--port 3081" make builder` 可以指定固定端口。按 `Ctrl-C` 停止服务。
