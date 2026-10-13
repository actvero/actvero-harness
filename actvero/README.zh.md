# ACTVERO 产品开发

[English](README.md) | 中文

## 账户开发

按锁文件安装依赖，然后启动接入平台服务的 ACTVERO 原生账户流程：

```sh
pnpm install --frozen-lockfile
ACTVERO_PLATFORM_URL=http://127.0.0.1:5194 pnpm run actvero:dev
```

成功构建后，`pnpm run actvero:start` 复用已有产物。运行时地址优先于构建默认值；界面只允许修改平台地址，issuer 由所连接的服务发现。凭据和 PKCE 证明仅保存在主进程加密存储中。一个可用组织自动选定；多个组织需要选择，平台为设备会话保留此选择。启动时需确认已恢复的账号后再进入工作区。本次浏览器登录在浏览器中显示已验证的账号及继续、切换操作；确认账号并验证组织后直接进入。确认退出后回到登录页，使用本地工作区需再次主动选择。

账户菜单提供设置、个人中心和退出登录，不显示菜单图标或重复的姓名、组织标题。设置中的「账号与额度」按各积分窗口展示剩余额度进度条。所有组织共用平台品牌。[账户插件](../packages/client/actvero-account/README.zh.md)说明界面和桥接职责；[登录恢复参考](account-recovery.zh.md)说明持久化与验收。

账户开发使用 `apps/desktop/.desktop-build/actvero-account-baseline/{home,electron-user-data}` 和调试端口 19429、19422、19430，不读取旧 ACTVERO 配置，也不替换已安装应用。重新加载构建产物前，先退出正在运行的账户开发实例。

## 官方基线

```sh
pnpm run actvero:dev:baseline
pnpm run actvero:start:baseline
```

这些命令保留官方账户界面，使用独立的 `actvero-baseline` 目录和端口 19329、19322、19330。官方基线行为不能作为 ACTVERO 平台登录的验收。

<a id="build-configuration"></a>

## 构建配置

```sh
pnpm run actvero:check
pnpm run actvero:prepare
```

`product.json` 管理产品身份、公开默认值和更新配置。`upstream.lock.json` 锁定官方基线，`plugins.lock.json` 锁定所选插件版本。准备命令只生成配置元数据，不安装插件。运行与构建代码不读取同级仓库。

源码发行版默认连接 `http://127.0.0.1:5194`，用于本机中台开发。连接其他部署时，在启动时设置 `ACTVERO_PLATFORM_URL`，或在 `.actvero-builder/` 下的私有构建预设中设置 `platform.defaultUrl`；参见[平台地址迁移](../docs/upgrade-guide/v0.2.0-rc.2/actvero-platform-address/guide.zh.md)。

[可配置构建](building/README.zh.md)说明品牌资源、构建/打包命令和主机要求。

## 交付范围

此开发流程接入登录、额度展示、平台模型选择和[专家、技能与 MCP 管理器](../packages/actvero/capability-ui/README.zh.md)。`平台模型`供应商读取平台模型目录，并由 Electron Main 按需签发短期单模型资源令牌；凭据不会进入渲染器或 Host。第三方侧栏与市场插件、签名发行安装包和更新渠道仍不属于本开发流程。本地工作区与自定义模型配置仍可使用。官方打包见[桌面参考](../apps/desktop/README.zh.md)。

[能力集成与验收](capabilities.zh.md)。
