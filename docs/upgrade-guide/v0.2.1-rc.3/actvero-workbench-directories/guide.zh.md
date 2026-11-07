---
kind: upgrade-guide
description: "ACTVERO 新建工作台对话使用独立工作目录，业务文件需要通过运行环境定位。"
---
# ACTVERO 工作台业务目录

[English](guide.md) | 中文

## 变更

新建工作台关联对话的工作目录从业务目录改为文件根目录下的 `.sessions/<instanceId>`。通过当前工作目录或相对路径访问业务文件的工作台需要改用运行环境的 `dataDirectory`。已有业务目录、JSON 状态、实例标识、关联事件和已有会话的工作目录均保留；不移动任何业务文件。

新增的自定义存储提供者默认关闭 AI，通过 `ai: true` 开启。旧式顶层 `initial/reduce/actionHelp` 提供者保持原有 JSON 和默认 AI 行为；采用新 `storage` 适配器时应显式声明是否使用 AI。

随包能力的会话关联会记录精确依赖摘要。恢复时摘要或编译指令变化会阻止后续请求，应重新选择当前安装的工作台；只读查看原会话记录仍可继续。取消关联和提供者注销现在等待能力释放，手动调用 `register()` 返回的注销函数时应 `await`，通过 `ctx.effect` 交给 Cordis 管理的调用无需改写。

直接构造 `WorkbenchRuntime` 的 Host 集成需要在配置中提供 `displayTimeoutMs`，单位为毫秒，用于限制等待客户端确认的时长。通过 Cordis 插件配置加载时可以省略，默认值为 `30000`；普通工作台作者无需更改。

直接调用能力包 `apply()` 的 Host 集成应提供 `platformTimeoutMs`，单位为毫秒。通过 Cordis 插件配置加载可省略，默认 `30000`；这与 `WorkbenchRuntime` 的显示等待配置分别处理。手动实现 `WorkbenchClientContext` 的集成需要补上 `models()`；普通工作台组件由宿主注入，无需自行实现。

## 迁移

1. 在 Host 服务中用 `runtime.open(id)` 获取实例，再用 `runtime.environment(instance)` 获取 `dataDirectory`。业务文件路径从该目录拼接，避免依赖进程目录或会话目录。参考[本地开发指南](../../../../actvero/workbench-development.zh.md#storage)。
2. 核对随包专家、MCP 和 CLI 的文件参数，传入明确的业务目录；路径本身不替代原生访问权限。
3. 保持工作台标识不变，重新打包并安装。先打开原有关联对话，再创建新对话，确认两者均能访问原有业务内容。现有用户无需搬移文件。
