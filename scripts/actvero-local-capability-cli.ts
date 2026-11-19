/** Parse local management commands without initializing the workbench compiler. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { localCapabilityCommand, localCapabilityOperations } from '../packages/actvero/capability-ui/src/workbench-local-protocol.ts'
import { developmentRequest } from './actvero-workbench-connection.ts'

/** Run a local Skill or MCP command against the selected Harness connection.
 * @param args CLI arguments beginning with skill or mcp.
 * @returns Desktop result to print as JSON. Validation and failed operations reject.
 */
export async function localCapabilityCli(args: string[]): Promise<unknown> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    connection: { type: 'string' }, file: { type: 'string' },
  } })
  const [group, action, source] = positionals
  if (positionals.length === 2 && action === 'help' && !values.file && !values.connection) {
    return { operations: localCapabilityOperations.filter(operation => operation.startsWith(group + '-')),
      usage: 'actvero-workbench skill|mcp <操作> --connection <连接文件> [--file <请求.json>]',
      install: 'actvero-workbench skill install <目录、ZIP 或 SKILL.md> --connection <连接文件>' }
  }
  if (!values.connection || !action || positionals.length > 3 || (source && (action !== 'install' || group !== 'skill' || values.file))) {
    throw new Error('请运行 actvero-workbench skill help 或 actvero-workbench mcp help 查看用法。')
  }
  let input: Record<string, unknown> = {}
  if (values.file) {
    const data = await readFile(values.file, 'utf8')
    if (data.length > 950_000) throw new Error('请求 JSON 超过大小限制。')
    input = z.record(z.string(), z.unknown()).parse(JSON.parse(data))
  }
  const operation = group + '-' + action
  const command = localCapabilityCommand.parse({ ...input, ...(source ? { path: resolve(source) } : {}), operation })
  return developmentRequest(values.connection, { action: 'local-capability', input: command }, AbortSignal.timeout(125_000))
}
