/** Host entry for local capability management through Desktop Main. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { localCapabilityCommand, localCapabilityOperations, localCapabilityReads, type LocalCapabilityCommand } from './workbench-local-protocol.ts'

const requestArgs = z.object({
  operation: z.enum(localCapabilityOperations),
  input_json: z.string().max(950_000).optional(),
}).strict()

function parseCall(input: unknown): LocalCapabilityCommand {
  const call = requestArgs.parse(input)
  const data = z.record(z.string(), z.unknown()).parse(JSON.parse(call.input_json ?? '{}'))
  return localCapabilityCommand.parse({ ...data, operation: call.operation })
}

/** Register the native command entry and its correlated Desktop relay.
 * @param ctx Host scope owning tool registration and IPC requests.
 * @returns Dispatch for the external CLI or undefined without Desktop IPC.
 */
export function registerLocalCapabilities(ctx: Context):
((command: LocalCapabilityCommand, signal?: AbortSignal) => Promise<unknown>) | undefined {
  if (!process.send) return undefined
  const pending = new Map<string, (error: Error | undefined, value?: unknown) => void>()
  let disposed = false
  ctx.effect(() => {
    const receive = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'actvero:workbench:result'
        || !('id' in message) || typeof message.id !== 'string') return
      const code = 'error' in message && typeof message.error === 'string' ? message.error : undefined
      pending.get(message.id)?.(code ? new Error(code) : undefined, 'value' in message ? message.value : undefined)
    }
    process.on('message', receive)
    return () => {
      disposed = true
      process.off('message', receive)
      for (const complete of pending.values()) complete(new Error('local_capability_outcome_unknown'))
    }
  })

  const run = async (command: LocalCapabilityCommand, signal?: AbortSignal): Promise<unknown> => {
    signal?.throwIfAborted()
    if (disposed || !process.connected) throw new Error('local_capability_unavailable')
    if (pending.size >= 64) throw new Error('operation_in_progress')
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const abandon = () => finish(new Error('local_capability_outcome_unknown'))
      const timer = setTimeout(abandon, 120_000)
      const finish = (error: Error | undefined, value?: unknown) => {
        if (!pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', abandon)
        if (error) reject(error)
        else resolve(value)
      }
      pending.set(id, finish)
      signal?.addEventListener('abort', abandon, { once: true })
      try {
        process.send?.({ type: 'actvero:workbench:request', id, action: 'manage-local', input: command }, (error) => {
          if (error) finish(new Error('local_capability_outcome_unknown'))
        })
      } catch (_error) { finish(new Error('local_capability_outcome_unknown')) }
    })
  }

  const name = 'local_capabilities'
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow' || exec.name !== name) return decision
    const { operation } = parseCall(exec.arguments)
    return localCapabilityReads.has(operation) ? decision : {
      kind: 'ask',
      reason: `Approve the local capability operation ${operation}. Changes apply across Harness conversations. MCP enable, test or update may start a local program or connect to a server.`,
      displayReason: {
        en: `Allow ${operation} in this Harness? MCP updates, tests and enablement may start a program or connect to a server.`,
        zh: `允许在此 Harness 执行 ${operation}？更新、测试或启用 MCP 可能启动程序或连接服务。`,
      },
    }
  })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'local_capabilities',
    description: 'Manage local Harness Skills and custom MCP connections using the same operations as actvero-workbench. '
      + 'List or show before changing an existing item. Use the current Skill version or MCP revision when updating. '
      + 'Only install or change what the user requested. New MCP configurations are saved disabled. Enter credentials in the connector manager.',
    timeoutMs: 125_000,
    parameters: {
      operation: { type: 'string', enum: localCapabilityOperations, required: true },
      input_json: { type: 'string', description: 'JSON object. show/test: {id}; skill-read: {id,path} from the file inventory; '
        + 'skill-install: {path} for an absolute folder, ZIP or SKILL.md; skill-update: {id,version,path}; skill-edit: {id,version,path,content}; '
        + 'enable: {id,enabled}; mcp-create: {config:{name,transport,command,args,cwd,url,auth,clientId}}; mcp-update: {id,revision,patch}.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => JSON.stringify(await run(parseCall(args), exec.signal)),
    presentCall: args => ({ card: 'generic', title: 'Manage local capabilities', kind: 'other', rawInput: args }),
  })))
  return run
}
