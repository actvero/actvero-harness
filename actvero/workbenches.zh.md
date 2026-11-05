# Actvero 客户端工作台

[English](workbenches.md) | 中文

本文面向维护 Actvero 桌面客户端的开发者，用于启动工作台预览、接入本地业务工作台，并判断安装和运行结果。

工作台运行上下文、可选宿主能力及内置本地专家的后续设计见[设计记录](../.agents/notes/proposed/architecture/2026-11-05-actvero-workbench-runtime.zh.md)。该记录明确设计方向，不表示统一开发接口已经发布。

## 启动和入口

完成依赖安装后，运行 `pnpm run actvero:dev`；已有最新构建时运行 `pnpm run actvero:start`。独立预览可运行 `pnpm run actvero:preview:workbenches`。这些入口使用开发数据，不读取已安装客户端的账户和会话。展开左侧栏，点击「工作台」进入本地首页；选择工作台后整页展示业务内容，通过顶部「业务／并排／对话」切换布局，左上角返回首页。

## 宿主和业务包

本地宿主由 [Actvero 工作台包](../packages/actvero/workbenches/README.zh.md) 提供。创作画布与素材说明是可保存的内置参考应用，不是已接通生成服务的业务插件。无需先选择文件夹或手动新建项目；打开 AI 助手后才建立原生会话，新话题沿用当前资料位置。业务资料与会话通过持久关联连接，不使用工作台独占会话模式。平台鉴权上下文、模型目录和内置专家自动加载尚未接入。

旧 DSH 工作台通过首页的「DSH 兼容市场」进入，继续沿用原来的切换和会话归属规则。MIT 许可与固定来源见 [第三方来源说明](third-party/dsh-desktop-workbenches/UPSTREAM.md)。公开市场仍读取 DSH 目录；Actvero 中台的发布、组织分发与审核尚未接入。

本地业务包通过 Host 提供者和 Client 业务插槽注册，开发接口、资料格式与模型工具见[包参考](../packages/actvero/workbenches/README.zh.md)。原 DSH bundle 使用 `ctx.desktopWorkbenches.register(descriptor, Component)`；其[上游开发规范快照](third-party/dsh-desktop-workbenches/)不代表在线最新规范，也不自动转换为 Actvero 业务提供者。

## 安装和版本限制

本地工作台安装走当前 Profile 的 Plugin Manager。安装结果、插件运行状态、左侧切换入口和真实业务界面需要分别检查；安装成功不代表全部验收通过。当前基线不支持直接覆盖更新同名工作台，适配层会明确拒绝覆盖并提示通过插件管理先卸载再安装，不自动删除插件。市场包若要求更高的 Harness 版本，仍由兼容性检查拒绝。

npm 市场包先按目录提供的 SHA-512 校验下载内容及包名、版本，再作为本地归档交给 Plugin Manager。原生安装审批和插件兼容性检查继续生效。业务工作台的账号、网络和文件访问能力仍由其自身及宿主策略决定。

## 开发验证

本地工作台的浏览器验收使用真实 Desktop Host，检查本地保存、原生输入框、视图与话题切换、草稿及刷新恢复，并覆盖浅色、深色和较窄窗口。旧 DSH 兼容验收独立保留；原生模型执行链另用无密钥适配器检查工作台指令、工具读写和 Session 日志。

构建与类型检查遵循仓库的 `build:artifacts`、`build:check` 流程。浏览器验收不替代签名安装包、真实组织账号和模型请求验收。
