# @actvero/dsh-model-gateway

Actvero 平台模型的 DSH Host 适配器。它使用 DSH 原生 `LlmAdapter`，由 Electron
Main 进程按需签发短期 `llm:catalog` 与 `llm:<model-uuid>` 令牌；渲染器和 Host
都不保存平台登录凭据。
