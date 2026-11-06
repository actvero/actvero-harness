# Actvero 客户端工作台

[English](workbenches.md) | 中文

本文面向维护 Actvero 桌面客户端的开发者，用于启动工作台预览、接入本地业务工作台，并判断安装和运行结果。

工作台运行上下文、可选宿主能力及内置本地专家的后续设计见[设计记录](../.agents/notes/proposed/architecture/2026-11-05-actvero-workbench-runtime.zh.md)。该记录明确设计方向，不表示统一开发接口已经发布。

## 启动和入口

完成依赖安装后，运行 `pnpm run actvero:dev`；已有最新构建时运行 `pnpm run actvero:start`。这两个入口使用独立开发数据，不读取已安装客户端的账户和会话。展开左侧栏，点击「DSH 工作台」打开兼容市场；右侧名称区域可切换普通会话与已加载的兼容工作台。「已安装」显示本地包及其实际运行状态。

「工作台」打开 Actvero 的「我的工作台」。可以搜索和按分类筛选，打开内置的「项目清单」或导入本机的 Actvero 工作台包。导入后的卡片在插件加载成功后出现，安装结果若提示重启，请使用「Harness → 重启 Harness」。「DSH 工作台」进入兼容的市场和旧工作台入口。

管理页沿用能力中心的布局，分为「平台工作台」与「我的工作台」；平台页当前显示未开放状态。「我的工作台」展示已添加且成功加载的工作台，不表示来源只能是本地。卡片展示最多三张预览，超过三张时显示剩余数量。点击卡片打开详情，点击缩略图定位到对应预览；详情支持缩略图选择、前后按钮、左右方向键与大图查看，并展示完整介绍、分类、来源、版本和已提供的作者。预览由工作台提供，不是当前项目的实时画面。

Actvero 本地包使用 npm 打包的 `.tgz`。包清单声明 `dsh.actveroWorkbench: 1`、bundle patch 和客户端入口，并声明客户端依赖 `@actvero/dsh-capability-ui`。客户端插件通过 `ctx.effect(() => ctx.actveroWorkbenches.register(descriptor, Component))` 注册卡片和业务组件。安装由当前 Profile 的插件管理器执行，打开业务页时使用已注册的组件。

## 宿主和业务包

工作台宿主采用 DataElement 的 DSH Desktop 源码，MIT 许可及固定来源见 [第三方来源说明](third-party/dsh-desktop-workbenches/UPSTREAM.md)。宿主保留工作台主页、市场目录、收藏、切换、安装状态，以及业务面板与原生 AI 会话的组合方式。当前市场仍读取 DSH 的公开目录；Actvero 中台的发布、组织分发与审核尚未接入。

业务工作台是独立的 DSH bundle。客户端加载包后，业务插件通过 `ctx.desktopWorkbenches.register(descriptor, Component)` 注册并返回注销函数；插件必须以 Cordis effect 管理注册。纯本地包可以省略仓库地址，宿主根据包名生成稳定身份。详细包格式和布局规则见随源码保留的 [上游开发规范快照](third-party/dsh-desktop-workbenches/)；快照不是在线最新规范。

普通分栏由宿主同时展示业务面板与原生会话。业务整页模式由业务组件安排首次使用入口，需要 AI 协助时调用宿主的会话接口并放置宿主提供的会话节点。客户端通过原生插槽和 Factory 组合会话，没有复制另一套聊天界面。侧栏过滤只影响展示；Session、Workspace Controller 的原始目录保持完整，普通会话与工作台会话各自保留。

## 安装和版本限制

本地工作台安装走当前 Profile 的 Plugin Manager。安装结果、插件运行状态、左侧切换入口和真实业务界面需要分别检查；安装成功不代表全部验收通过。当前基线不支持直接覆盖更新同名工作台，适配层会明确拒绝覆盖并提示通过插件管理先卸载再安装，不自动删除插件。市场包若要求更高的 Harness 版本，仍由兼容性检查拒绝。

npm 市场包先按目录提供的 SHA-512 校验下载内容及包名、版本，再作为本地归档交给 Plugin Manager。原生安装审批和插件兼容性检查继续生效。业务工作台的账号、网络和文件访问能力仍由其自身及宿主策略决定。

## 开发验证

`apps/web/tests/actvero-workbenches.e2e.ts` 使用真实 Desktop Host 和临时本地工作台包，检查已安装列表、切换、首次无会话入口、按需打开原生对话、刷新恢复以及浅色、深色和较窄窗口。示例包只存在于临时验收 Profile，不作为业务工作台随产品发布。工作区导航测试检查会话归属、空白会话复用及过滤贡献的注销。

构建与类型检查遵循仓库的 `build:artifacts`、`build:check` 流程。浏览器验收不替代签名安装包、真实组织账号和模型请求验收。
