/** Actvero platform model catalog and OpenAI-compatible chat adapter. */

import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  attributionHeaders,
  fileHandleText,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  requestImageHandleText,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  RequestMessage,
  StreamChunk,
  TokenUsage,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import { randomUUID } from 'node:crypto'

export const name = 'actvero-model-gateway'
export const inject = ['llm']

/** The platform route has no user-editable endpoint or credential fields. */
export type Config = Readonly<Record<string, never>>
export const Config = z.object({}) as unknown as z<Config>

const PROVIDER = 'actvero-platform'
const CATALOG_RESOURCE = 'llm:catalog'
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const MODEL_RESOURCE = /^llm:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

interface ResourceToken {
  access_token: string
  token_type: 'Bearer'
  resource: string
  endpoint: string
  scope: string
  expires_in: number
}

interface CatalogOperation {
  kind?: unknown
  input_modalities?: unknown
  output_modalities?: unknown
  capabilities?: unknown
  endpoint?: unknown
  context_window?: unknown
  max_output?: unknown
  max_tokens?: unknown
  reasoning_options?: unknown
  /** Compatibility with early platform catalog clients that used camelCase. */
  reasoningOptions?: unknown
  parameters?: unknown
  limits?: unknown
}

interface CatalogModel {
  id: string
  name?: string
  description?: string
  resource: string
  operations: CatalogOperation[]
}

interface ToolCallState {
  index: number
  id: ToolCallId
  name: string
  arguments: string
}

interface ModelRoute {
  resource: string
  /** Undefined means the catalog did not declare a preference. */
  streaming?: boolean
}

type OpenAiPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAiMessage = {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content?: string | OpenAiPart[] | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined
}

function endpointUrl(endpoint: string, path: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  const url = new URL(path.replace(/^\//, ''), base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new LlmError('平台模型返回了无效的服务地址', 'INVALID_RESPONSE')
  }
  return url.toString()
}

function parseToken(raw: unknown, resource: string): ResourceToken {
  const value = record(raw)
  const access = text(value?.access_token)
  const endpoint = text(value?.endpoint)
  if (!access || !endpoint || value?.resource !== resource || value.token_type !== 'Bearer') {
    throw new LlmError('平台模型令牌响应无效', 'INVALID_RESPONSE')
  }
  try { endpointUrl(endpoint, '') } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmError('平台模型返回了无效的服务地址', 'INVALID_RESPONSE', { cause: error })
  }
  const expires = value.expires_in
  if (!Number.isFinite(expires) || (expires as number) <= 0 || (expires as number) > 600) {
    throw new LlmError('平台模型令牌有效期无效', 'INVALID_RESPONSE')
  }
  return {
    access_token: access,
    token_type: 'Bearer',
    resource,
    endpoint,
    scope: text(value.scope) ?? resource,
    expires_in: expires as number,
  }
}

class MainBridge {
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private disposed = false
  private readonly receiveMessage = (raw: unknown) => {
    const value = record(raw)
    if (!value || value.type !== 'actvero:llm:result' || typeof value.id !== 'string') {
      if (value?.type === 'actvero:llm:changed') this.onChanged?.()
      return
    }
    const entry = this.pending.get(value.id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(value.id)
    if (typeof value.error === 'string') entry.reject(new Error(value.error))
    else entry.resolve(value.value)
  }
  private onChanged: (() => void) | undefined

  constructor(ctx: Context) {
    ctx.effect(() => {
      process.on('message', this.receiveMessage)
      return () => {
        this.disposed = true
        process.off('message', this.receiveMessage)
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer)
          entry.reject(new Error('platform_model_unavailable'))
        }
        this.pending.clear()
      }
    })
  }

  setChanged(handler: () => void): void { this.onChanged = handler }

  request(resource: string): Promise<ResourceToken> {
    return new Promise((resolve, reject) => {
      if (this.disposed || !process.send) {
        reject(new Error('platform_model_unavailable'))
        return
      }
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('platform_model_timeout'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: value => resolve(parseToken(value, resource)), reject, timer })
      try {
        process.send({ type: 'actvero:llm:request', id, action: 'resource-token', input: { resource } })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error as Error)
      }
    })
  }
}

function chatOperation(model: CatalogModel): CatalogOperation {
  const operation = model.operations.find(candidate => candidate.kind === 'chat')
  if (!operation) throw new LlmError(`平台模型 ${model.id} 不支持对话`, 'MODEL_UNAVAILABLE')
  return operation
}

function streamingCapability(operation: CatalogOperation): boolean | undefined {
  // The platform model catalog exposes the negotiated endpoint capability as
  // `operations[].endpoint.stream`. Treat it as authoritative when present.
  // Some older catalog responses only expose `capabilities.streaming`, so keep
  // that form as a backwards-compatible fallback.
  const endpoint = record(operation.endpoint)
  if (endpoint?.stream === true) return true
  if (endpoint?.stream === false) return false
  const value = record(operation.capabilities)?.streaming
  if (value === true) return true
  if (value === false) return false
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[- ]/g, '_')
  if (['supported', 'support', 'enabled', 'true'].includes(normalized)) return true
  if (['unsupported', 'not_supported', 'disabled', 'unavailable', 'false'].includes(normalized)) return false
  return undefined
}

function modalities(operation: CatalogOperation): ('text' | 'image')[] | undefined {
  if (!Array.isArray(operation.input_modalities)) return undefined
  const values = operation.input_modalities.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
  return values.length > 0 ? [...new Set(values)] : undefined
}

const REASONING_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

function reasoning(operation: CatalogOperation): LlmResolvedModelInfo['reasoning'] {
  // The current platform contract uses operation.reasoning_options. Accept the
  // camelCase and nested forms emitted by early catalog clients as well; this
  // keeps the selector useful while those clients are upgraded. We still only
  // expose levels explicitly declared by the platform, never a model-name
  // based fallback.
  const parameters = record(operation.parameters)
  const capabilities = record(operation.capabilities)
  const raw = operation.reasoning_options
    ?? operation.reasoningOptions
    ?? parameters?.reasoning_options
    ?? parameters?.reasoningOptions
    ?? capabilities?.reasoning_options
    ?? capabilities?.reasoningOptions
  const rawOptions = record(raw)?.options
  const options: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(rawOptions)
      ? rawOptions
      : []
  const option = options.map(record).find(row => row?.type === 'effort')
  const values = Array.isArray(option?.values)
    ? option.values.map((value) => {
      if (typeof value === 'string') return value
      const entry = record(value)
      return text(entry?.id) ?? text(entry?.value) ?? text(entry?.name)
    }).filter((value): value is string => typeof value === 'string' && value.length > 0 && value !== 'default')
    : []
  const efforts = [...new Set(values)].map(value => ({
    id: ReasoningEffortId(value),
    name: REASONING_LABELS[value] ?? value,
  }))
  return efforts.length === 0 ? undefined : { efforts }
}

function modelInfo(model: CatalogModel, provider = PROVIDER): LlmResolvedModelInfo {
  const operation = chatOperation(model)
  const contextWindow = positiveInteger(operation.context_window)
  const maxOutput = positiveInteger(operation.max_output) ?? positiveInteger(operation.max_tokens)
  const inputModalities = modalities(operation)
  const modelReasoning = reasoning(operation)
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...text(model.description) === undefined ? {} : { description: model.description },
    ...inputModalities === undefined ? {} : { inputModalities },
    ...contextWindow === undefined ? {} : { context: { contextWindow } },
    ...maxOutput === undefined ? {} : { defaultMaxTokens: maxOutput },
    ...modelReasoning === undefined ? {} : { reasoning: modelReasoning },
  }
}

function contentText(parts: OpenAiPart[]): string | OpenAiPart[] | null {
  if (parts.length === 0) return null
  if (parts.every(part => part.type === 'text')) return parts.map(part => part.text).join('')
  return parts
}

class PlatformAdapter extends LlmAdapter {
  private catalogPromise: Promise<CatalogModel[]> | undefined
  private catalogExpires = 0
  private readonly resources = new Map<string, ModelRoute>()

  constructor(private readonly bridge: MainBridge, private readonly attachments: () => AttachmentStore | undefined) { super() }

  invalidate(): void {
    this.catalogPromise = undefined
    this.catalogExpires = 0
    this.resources.clear()
  }

  override providerInfo(provider: string) { return { id: provider, name: '平台模型' } }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider !== PROVIDER) return []
    const catalog = await this.catalog()
    return catalog.flatMap((model) => {
      try { return [modelInfo(model)] } catch { return [] }
    })
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    if (provider !== PROVIDER) throw new LlmError('平台模型路由不存在', 'NO_ADAPTER')
    signal?.throwIfAborted()
    const row = (await this.catalog()).find(candidate => candidate.id === model)
    if (!row) throw new LlmError(`平台模型 ${model} 不存在或无权访问`, 'MODEL_UNAVAILABLE')
    const operation = chatOperation(row)
    this.resources.set(row.id, { resource: row.resource, streaming: streamingCapability(operation) })
    return modelInfo(row)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: options => this.stream(options) }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generateStream(options)
  }

  private async catalog(): Promise<CatalogModel[]> {
    if (this.catalogPromise && Date.now() < this.catalogExpires) return this.catalogPromise
    const promise = this.loadCatalog()
    this.catalogPromise = promise
    this.catalogExpires = Date.now() + 30_000
    try { return await promise } catch (error) {
      if (this.catalogPromise === promise) this.catalogPromise = undefined
      throw error
    }
  }

  private async loadCatalog(): Promise<CatalogModel[]> {
    const token = await this.bridge.request(CATALOG_RESOURCE)
    const rows: CatalogModel[] = []
    for (let page = 1; page <= 100; page++) {
      const response = await fetch(endpointUrl(token.endpoint, `models?page=${page}`), {
        headers: { ...attributionHeaders(), authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
      })
      if (!response.ok) throw await responseFailure(response, '模型目录读取失败')
      const raw = record(await response.json())
      if (!Array.isArray(raw?.data)) throw new LlmError('平台模型目录响应无效', 'INVALID_RESPONSE')
      for (const value of raw.data) {
        const row = record(value)
        const id = text(row?.id)
        const resource = text(row?.resource)
        const operations = Array.isArray(row?.operations) ? row.operations.filter((op): op is CatalogOperation => !!record(op)) : []
        const name = text(row?.name)
        const description = text(row?.description)
        if (id && resource && MODEL_RESOURCE.test(resource)) rows.push({
          id, resource, operations,
          ...name === undefined ? {} : { name },
          ...description === undefined ? {} : { description },
        })
      }
      if (raw.has_more !== true) break
    }
    this.resources.clear()
    for (const row of rows) {
      try {
        const operation = chatOperation(row)
        this.resources.set(row.id, { resource: row.resource, streaming: streamingCapability(operation) })
      } catch { /* listModels filters models without chat below. */ }
    }
    return rows
  }

  private async *generateStream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const signal = options.signal
    signal?.throwIfAborted()
    let route = this.resources.get(options.model)
    if (!route) {
      await this.resolveModel(options.provider, options.model, signal)
      route = this.resources.get(options.model)
    }
    if (!route) throw new LlmError(`平台模型 ${options.model} 不存在或无权访问`, 'MODEL_UNAVAILABLE')
    const token = await this.bridge.request(route.resource)
    const messages = await this.messages(options, signal)
    // The platform catalog can explicitly mark a model as non-streaming. DSH's
    // conversation surface is stream-shaped, so use the ordinary JSON response
    // and adapt it into one complete DSH stream instead of rejecting the turn.
    // Stream only when the platform explicitly declares support. Unknown or
    // omitted capability metadata must use the JSON path, otherwise the
    // platform correctly rejects the request as unsupported streaming.
    const stream = route.streaming === true
    const body: Record<string, unknown> = {
      model: options.model,
      messages,
      stream,
      ...stream ? { stream_options: { include_usage: true } } : {},
      ...options.maxTokens === undefined ? {} : { max_completion_tokens: options.maxTokens },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.stop === undefined ? {} : { stop: options.stop },
      ...options.reasoningEffort === undefined ? {} : { reasoning_effort: String(options.reasoningEffort) },
      ...options.tools === undefined ? {} : { tools: options.tools.map(tool) },
    }
    let response: Response
    try {
      response = await fetch(endpointUrl(token.endpoint, 'chat/completions'), {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: { ...attributionHeaders(), authorization: `Bearer ${token.access_token}`, accept: stream ? 'text/event-stream' : 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (signal?.aborted) throw new LlmError('平台模型请求已取消', 'ABORTED', { cause: error })
      throw new LlmError('平台模型网络请求失败', 'TRANSPORT', { cause: error })
    }
    if (!response.ok) throw await responseFailure(response, '平台模型调用失败')
    if (response.body === null) throw new LlmError('平台模型没有返回响应', 'EMPTY_RESPONSE')
    if (stream) yield* parseStream(response.body, signal)
    else yield* parseBuffered(response, signal)
  }

  private async messages(options: GenerateOptions, signal?: AbortSignal): Promise<OpenAiMessage[]> {
    const output: OpenAiMessage[] = []
    if (options.system) output.push({ role: 'system', content: options.system })
    for (const message of options.messages) output.push(await this.message(message, signal))
    return output
  }

  private async message(message: RequestMessage, signal?: AbortSignal): Promise<OpenAiMessage> {
    if (message.role === 'assistant') {
      const textParts = message.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => ({ type: 'text' as const, text: block.text }))
      const calls = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call').map(block => ({ id: String(block.id), type: 'function' as const, function: { name: block.name, arguments: block.arguments } }))
      return { role: 'assistant', content: contentText(textParts), ...calls.length === 0 ? {} : { tool_calls: calls } }
    }
    const parts = await this.parts(message.content, message.role, signal)
    if (message.role === 'tool') return { role: 'tool', content: contentText(parts), tool_call_id: String(message.toolCallId) }
    return { role: message.role, content: contentText(parts) }
  }

  private async parts(blocks: readonly ContentBlock[], role: RequestMessage['role'], signal?: AbortSignal): Promise<OpenAiPart[]> {
    const parts: OpenAiPart[] = []
    for (const block of blocks) {
      if (block.type === 'text') { if (block.text) parts.push({ type: 'text', text: block.text }); continue }
      if (block.type === 'file') { parts.push({ type: 'text', text: fileHandleText(block.attachment, undefined) }); continue }
      if (block.type === 'reasoning') continue
      if (block.type === 'tool-addition' || block.type === 'tool-removal') continue
      if (block.type !== 'image') continue
      if (role !== 'user' && role !== 'tool') throw new LlmError('平台模型仅支持用户和工具消息中的图片', 'UNSUPPORTED_CONTENT')
      const attachment = this.attachments()
      if (!attachment) throw new LlmError('平台模型图片需要附件服务', 'UNSUPPORTED_CONTENT')
      signal?.throwIfAborted()
      const image = await attachment.readImageRequest(block.attachment, { width: block.attachment.width, height: block.attachment.height, maxBytes: IMAGE_MAX_BYTES }, signal)
      parts.push({ type: 'text', text: requestImageHandleText(block.attachment, image) })
      parts.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}` } })
    }
    return parts
  }
}

function tool(tool: ToolSchema) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
}

async function responseFailure(response: Response, prefix: string): Promise<LlmError> {
  const rawText = await response.text().catch(() => '')
  let message = prefix
  try {
    const raw = record(JSON.parse(rawText))
    const error = record(raw?.error)
    if (typeof error?.message === 'string' && error.message.length > 0) message = error.message
  } catch { /* HTTP status remains the authoritative diagnostic. */ }
  const code = response.status === 401 || response.status === 403 ? 'AUTH'
    : response.status === 429 ? 'RATE_LIMIT'
      : response.status === 404 ? 'MODEL_UNAVAILABLE' : 'PROVIDER_ERROR'
  const retryAfter = Number(response.headers.get('retry-after'))
  return new LlmError(message, code, { status: response.status, ...Number.isFinite(retryAfter) && retryAfter > 0 ? { providerRetryAfterMs: retryAfter * 1000 } : {} })
}

async function* parseBuffered(response: Response, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  signal?.throwIfAborted()
  let raw: unknown
  try { raw = await response.json() } catch (error) { throw new LlmError('平台模型 JSON 响应无效', 'MALFORMED_RESPONSE', { cause: error }) }
  const value = record(raw)
  const choices = Array.isArray(value?.choices) ? value.choices : []
  const choice = record(choices[0])
  const message = record(choice?.message)
  if (!choice || !message) throw new LlmError('平台模型响应缺少消息', 'MALFORMED_RESPONSE')
  let nextIndex = 0
  const content = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.flatMap((part) => { const row = record(part); return text(row?.text) ?? [] }).join('')
      : ''
  if (content) {
    const index = nextIndex++
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'text-delta', index, text: content }
    yield { type: 'block-end', index, block: { type: 'text', text: content } }
  }
  const thought = text(message.reasoning_content) ?? text(message.reasoning)
  if (thought) {
    const index = nextIndex++
    yield { type: 'block-start', index, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index, text: thought }
    yield { type: 'block-end', index, block: { type: 'reasoning', text: thought } }
  }
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  for (const [callIndex, rawCall] of rawCalls.entries()) {
    const call = record(rawCall)
    if (!call) continue
    const fn = record(call.function)
    const id = ToolCallId(text(call.id) ?? `call_${callIndex}`)
    const name = text(fn?.name) ?? ''
    const args = text(fn?.arguments) ?? '{}'
    const index = nextIndex++
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, ...(name ? { name } : {}), argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
  }
  const rawUsage = record(value?.usage)
  if (rawUsage) yield { type: 'usage', usage: normalizeUsage(rawUsage) }
  const finishReason = text(choice.finish_reason)
  const finish: 'stop' | 'tool-calls' | 'max-tokens' = finishReason === 'tool_calls' || rawCalls.length > 0
    ? 'tool-calls'
    : finishReason === 'length' ? 'max-tokens' : 'stop'
  yield { type: 'finish', reason: { kind: finish } }
}

async function* parseStream(body: ReadableStream<BufferSource>, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const events = body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())
  let textValue = ''
  let reasoningValue = ''
  let textIndex: number | undefined
  let reasoningIndex: number | undefined
  let nextIndex = 0
  const calls = new Map<number, ToolCallState>()
  let finish: 'stop' | 'tool-calls' | 'max-tokens' = 'stop'
  let usage: TokenUsage | undefined
  for await (const frame of events) {
    signal?.throwIfAborted()
    if (frame.data === '[DONE]') break
    let raw: unknown
    try { raw = JSON.parse(frame.data) } catch (error) { throw new LlmError('平台模型 SSE 数据无效', 'MALFORMED_RESPONSE', { cause: error }) }
    const value = record(raw)
    if (!value) continue
    const rawUsage = record(value.usage)
    if (rawUsage) usage = normalizeUsage(rawUsage)
    const choices = Array.isArray(value.choices) ? value.choices : []
    const choice = record(choices[0])
    if (!choice) continue
    const delta = record(choice.delta)
    if (delta) {
      const content = text(delta.content)
      if (content) {
        if (textIndex === undefined) { textIndex = nextIndex++; yield { type: 'block-start', index: textIndex, blockType: 'text' } }
        textValue += content
        yield { type: 'text-delta', index: textIndex, text: content }
      }
      const thought = text(delta.reasoning_content) ?? text(delta.reasoning)
      if (thought) {
        if (reasoningIndex === undefined) { reasoningIndex = nextIndex++; yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' } }
        reasoningValue += thought
        yield { type: 'reasoning-delta', index: reasoningIndex, text: thought }
      }
      if (Array.isArray(delta.tool_calls)) for (const rawCall of delta.tool_calls) {
        const call = record(rawCall)
        if (!call) continue
        const callIndex = Number.isSafeInteger(call?.index) ? call.index as number : calls.size
        let state = calls.get(callIndex)
        if (!state) {
          const id = text(call?.id) ?? `call_${callIndex}`
          state = { index: nextIndex++, id: ToolCallId(id), name: '', arguments: '' }
          calls.set(callIndex, state)
          yield { type: 'block-start', index: state.index, blockType: 'tool-call' }
        }
        const fn = record(call?.function)
        const name = text(fn?.name)
        if (name) state.name += name
        const args = text(fn?.arguments) ?? ''
        state.arguments += args
        yield { type: 'tool-call-delta', index: state.index, id: state.id, ...name === undefined ? {} : { name }, argumentsDelta: args }
      }
    }
    const finishReason = text(choice.finish_reason)
    if (finishReason === 'tool_calls') finish = 'tool-calls'
    else if (finishReason === 'length') finish = 'max-tokens'
    else if (finishReason === 'stop') finish = 'stop'
  }
  if (textIndex !== undefined) yield { type: 'block-end', index: textIndex, block: { type: 'text', text: textValue } }
  if (reasoningIndex !== undefined) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoningValue } }
  for (const state of calls.values()) yield { type: 'block-end', index: state.index, block: { type: 'tool-call', id: state.id, name: state.name, arguments: state.arguments || '{}' } }
  if (usage !== undefined) yield { type: 'usage', usage }
  yield { type: 'finish', reason: { kind: finish } }
}

function normalizeUsage(raw: Record<string, unknown>): TokenUsage {
  const inputTokens = Number.isSafeInteger(raw.prompt_tokens) && (raw.prompt_tokens as number) >= 0 ? raw.prompt_tokens as number : 0
  const outputTokens = Number.isSafeInteger(raw.completion_tokens) && (raw.completion_tokens as number) >= 0 ? raw.completion_tokens as number : 0
  const details = record(raw.prompt_tokens_details)
  const cached = details?.cached_tokens
  const cacheRead = Number.isSafeInteger(cached) && (cached as number) >= 0 ? cached as number : undefined
  const uncached = Math.max(0, inputTokens - (cacheRead ?? 0))
  return {
    inputTokens: uncached,
    outputTokens,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...Number.isSafeInteger(raw.total_tokens) && (raw.total_tokens as number) >= 0 ? { totalTokens: raw.total_tokens as number } : {},
  }
}

export function apply(ctx: Context, _config: Config): void {
  // Keep a settings namespace so the native Models page can render the
  // provider row. The platform owns endpoint, credentials, and model catalog;
  // there is intentionally no editable provider profile here.
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: '平台模型',
      settingsNs: ctx.fiber.entry?.options.id ?? name,
      settingsPath: [],
    },
  ])
  if (!process.send) return
  const bridge = new MainBridge(ctx)
  const adapter = new PlatformAdapter(bridge, () => ctx.get('attachments'))
  bridge.setChanged(() => adapter.invalidate())
  ctx.llm.registerAdapter([PROVIDER], adapter)
}
