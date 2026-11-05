# DSH Desktop 工作台来源与适配

本目录包含 DataElement 的 DSH Desktop 工作台宿主，来源为 https://github.com/dataelement/dsh-desktop 的 `packages/dsh-desktop-workbenches/`，固定提交 `8504fd59d3ef44db819728b3d2d187ed33e21f35`。上游采用 MIT 许可证，版权及许可全文见本目录 `LICENSE`。

Actvero 将其作为本地文件依赖接入桌面 Profile，保留原有工作台注册方式、管理界面、布局、收藏、笔记和市场目录。本目录属于第三方源码，不是 Actvero 中台的工作台发布接口。

适配范围：本机 Desktop Profile 的包检查路径；当前 Plugin Manager 的安装选项；原生 Conversation Frame Factory；现有会话行图标插槽。原生侧栏、会话和工作区扩展位由各自源码模块维护。

业务工作台仍是独立安装的 DSH bundle。注册、加载和运行结果需要分别核验，插件包兼容性由实际 Harness 版本检查决定。

当前基线不支持原子覆盖更新已安装插件；适配层会拒绝覆盖并提示先卸载再安装，不自动删除已有插件。npm 市场包先下载到临时目录，按目录提供的 SHA-512 和包内名称、版本验证，再交给当前 Plugin Manager。原市场目录仍属于 DSH，尚未对接 Actvero 工作台发布服务。
