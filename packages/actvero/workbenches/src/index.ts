/** Actvero local workbench Host: durable business state, native Sessions and session-scoped tools. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { registerAgentContext } from './agent-context.ts'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { actionSchema, WorkbenchError, type WorkbenchProvider } from './contracts.ts'
import { exampleProviders } from './examples.ts'
import { WorkbenchRuntime } from './runtime.ts'
export { WorkbenchRuntime } from './runtime.ts'
export type { WorkbenchProvider } from './contracts.ts'
/** Cordis plugin identity for the local workbench host. */
export const name = 'actvero-local-workbenches'
/** Required native services; missing services prevent plugin activation. */
export const inject = ['connection', 'sessionController', 'workspaceRegistry', 'agents', 'tools', 'systemPrompt']
/** Local storage, polling and archive limits resolved at plugin activation. */
export interface Config {
  /** Absolute local directory containing business records and managed project files. */
  root: string
  /** Milliseconds between client state reads; at least 500. */
  refreshIntervalMs: number
  /** Maximum compressed archive size accepted for local bundle staging. */
  maxImportBytes: number
  /** Include the bundled creative and asset-notes reference providers. */
  examples: boolean
}
/** Local storage, polling and archive limits resolved at plugin activation. */
export const Config: Schema<Config> = Schema.object({
  root: Schema.string().required(),
  refreshIntervalMs: Schema.natural().min(500).default(2500),
  maxImportBytes: Schema.natural().min(1024).default(16 * 1024 * 1024),
  examples: Schema.boolean().default(true),
})
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local business-provider registration; package README owns this interface. */
    actveroWorkbenchRuntime: { register(provider: WorkbenchProvider): () => void }
  }
}
const PREFIX = '/api/actvero-workbenches'
async function bytes(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader)
    throw new WorkbenchError('invalid-request')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done)
        break
      length += next.value.length
      if (length > limit)
        throw new WorkbenchError('invalid-request')
      chunks.push(next.value)
    }
  }
  finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
function failure(error: unknown): Response {
  const code = error instanceof WorkbenchError ? error.code : error instanceof z.ZodError || error instanceof SyntaxError ? 'invalid-request' : 'unavailable'
  return Response.json({ error: code }, { status: code === 'conflict' ? 409 : code === 'invalid-request' ? 400 : 503 })
}
/** Compose the workbench plugin through native services and disposable registrations.
 * @param ctx - Cordis registration owner.
 * @param config - Resolved host options. */
export function apply(ctx: Context, config: Config): void {
  const runtime = new WorkbenchRuntime(ctx, config.root, config.refreshIntervalMs)
  ctx.effect(() => ctx.reflect.provide('actveroWorkbenchRuntime', { register: (provider: WorkbenchProvider) => runtime.register(provider) }))
  if (config.examples)
    for (const provider of exampleProviders())
      ctx.effect(() => runtime.register(provider))
  ctx.connection.fetch.register({ path: PREFIX + '/state', methods: ['GET'], requestBody: 'buffered', async fetch() {
    try {
      return Response.json(await runtime.snapshot(), { headers: { 'cache-control': 'no-store' } })
    }
    catch (error) {
      ctx.logger.warn('Local workbench state read failed: %s', error)
      return failure(error)
    }
  } })
  ctx.connection.fetch.register({ path: PREFIX + '/action', methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    try {
      return Response.json(await runtime.action(actionSchema.parse(JSON.parse(Buffer.from(await bytes(request, 1024 * 1024)).toString('utf8')))))
    }
    catch (error) {
      ctx.logger.warn('Local workbench action failed: %s', error)
      return failure(error)
    }
  } })
  ctx.connection.fetch.register({ path: PREFIX + '/import', methods: ['POST'], requestBody: 'buffered', async fetch(request) {
    try {
      const archive = await bytes(request, config.maxImportBytes)
      if (archive[0] !== 0x1f || archive[1] !== 0x8b)
        throw new WorkbenchError('invalid-request')
      const directory = join(config.root, 'imports')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, randomUUID() + '.tgz')
      await writeFile(path, archive, { flag: 'wx', mode: 0o600 })
      return Response.json({ path })
    }
    catch (error) {
      ctx.logger.warn('Local workbench archive staging failed: %s', error)
      return failure(error)
    }
  } })
  ctx.connection.fetch.register({ path: PREFIX + '/reference.png', methods: ['GET'], requestBody: 'buffered', async fetch() {
    return new Response(await readFile(new URL('../assets/autumn-backpack.png', import.meta.url)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } })
  } })
  registerAgentContext(ctx, runtime)
}
