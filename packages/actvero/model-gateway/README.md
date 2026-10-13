# @actvero/dsh-model-gateway

Host-side DSH LLM adapter for the Actvero platform model catalog. The adapter
uses DSH's native `LlmAdapter` contract and asks the Electron Main process for
short-lived `llm:catalog` and `llm:<model-uuid>` resource tokens. It does not
store or expose platform credentials in the renderer or Host process.
