# 游戏模式插件集成

[English](README.md) | 中文

本文供 ACTVERO 桌面维护者更新独立插件及其宿主接线。插件源代码位于 [actvero-game-mode](https://github.com/heyjianhang/actvero-game-mode)，此目录保留供当前桌面组合消费的 `0.1.0-alpha.3` 文件包，完整性由根 `pnpm-lock.yaml` 固定。

## 加载

桌面与 Web bundle 的 resolver 通过 `file:` 依赖读取相同归档。插件管理器通过包内 `dsh.bundle` 声明插入 Host 行，DSH Loader 加载包内 Client；Web 基础组合不再重复插入此行。Electron Main 与受信任主 frame 的 preload 提供窗口桥接。未安装插件时没有入口；安装到缺少窗口桥接或专家服务的宿主后，设置页持续显示配套桌面版本要求。专家和语音沿用各自原生客户端服务，不创建另一套会话或识别器。

更新时在独立仓库完成 `pnpm check` 和 `pnpm pack`，将新版本文件包与两个 resolver 依赖、根锁文件一起更新。本目录不包含插件源码；不要通过修改解包后的 `node_modules` 交付变更。

## 验证

浏览器场景 `apps/web/tests/actvero-game-mode.e2e.ts` 使用真实 Loader、原生会话、设置与 UI，系统窗口、账户和专家资源入口使用无凭据替身。场景通过已安装组合包启动，检查旧宿主兼容提示、草稿保留、专家选择、设置持久化、明暗主题、窄窗口菜单及退出恢复；截图写入隔离的 `.artifacts/game-mode/run-*` 目录。原生语音控件测试覆盖按住、取消、权限延迟、旧操作隔离与草稿保护。

macOS/Windows 系统材质、游戏全屏、真实麦克风和硬件手柄尚需实机验收。当前手柄只支持窗口前台操作，不能在后台游戏中用手柄呼出。构建通过不等于安装包、签名或实机验收通过。
