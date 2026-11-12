---
name: actvero-workbench-development
description: 为 Actvero 桌面端开发、打包、更新或验收工作台，包括为组织发布的工作台声明运行配置字段。
---

面向在本地源码项目中创建或修改 Actvero 工作台的开发 Agent。先读取项目的开发约定，再查阅与目标桌面端版本匹配的[工作台开发手册](../../workbench-development.zh.md)。独立安装此 Skill 时，可从 [Actvero Harness 仓库](https://github.com/actvero/actvero-harness/blob/main/actvero/workbench-development.zh.md) 查阅手册。

- 新项目使用手册中的模板和 `actvero:workbench` 开发命令。已有工作台沿用它的构建入口，保持 `package.json.name` 和注册标识一致。交付新包时提高版本号，用项目的打包入口生成并校验 `.tgz`，再在桌面端导入验收。
- 组织运行配置声明在安装包的 `package.json` 中，路径为 `dsh.actveroWorkbenchConfig`。每项包含唯一的 `key` 和显示名 `label`，可设置 `kind`（`text` 或 `url`）、`required`、`description`、`default`。字段约束和例子见手册的「组织运行配置」。
- 在客户端业务组件调用 `await workbench.config()`，按运行版本声明的 Key 读取当前组织授权的值。管理员通过后台填值。跨版本保留同一 Key 可沿用已有值。服务地址等非敏感参数适合放在这里。API Key 和其他凭据交给宿主凭据服务。
- 业务需要依赖某个配置时，检查读取失败和缺值的处理。验收时分别验证包能加载、业务界面能打开，以及授权账号能读到当前组织的配置。
