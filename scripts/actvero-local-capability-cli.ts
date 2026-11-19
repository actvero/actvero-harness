/** Local authoring commands use the same contract as their offline help. */
import { isAbsolute, resolve } from 'node:path'
import { localCapabilityCommand } from '../packages/actvero/capability-ui/src/workbench-local-protocol.ts'
import { parseWorkbenchInvocation } from './actvero-workbench-command-guide.ts'
import { parseCliInput, readCliJson, validateCliResult, WorkbenchCliError } from './actvero-workbench-cli-result.ts'
import { developmentRequest } from './actvero-workbench-connection.ts'

/** Run a local Skill, MCP or Expert command against the selected Harness connection.
 * @param args CLI arguments beginning with skill, mcp or expert.
 * @returns Desktop result validated against the selected command's output schema.
 */
export async function localCapabilityCli(args: string[]): Promise<unknown> {
  const { name, entry, values, positionals } = parseWorkbenchInvocation(args)
  if (!entry.input || typeof values.connection !== 'string') {
    throw new WorkbenchCliError('invalid_arguments', '此命令需要 Harness 开发连接文件。', 'not_applied')
  }
  const source = positionals[0]
  const input = parseCliInput(entry.input, typeof values.file === 'string' ? await readCliJson(values.file, 'request')
    : source ? { path: resolve(source) } : {})
  const [group, operation] = name.split('.')
  const command = group === 'expert' ? { action: 'expert', operation, input } : localRequest(group + '-' + operation, input)
  const value = await developmentRequest(values.connection, command, undefined, { readOnly: entry.effect === 'read', recovery: entry.recovery })
  return validateCliResult(entry.output, value, entry.effect === 'read', entry.recovery)
}

function localRequest(operation: string, payload: unknown) {
  const input = parseCliInput(localCapabilityCommand, { ...payload as object, operation })
  if ((input.operation === 'skill-install' || input.operation === 'skill-update') && !isAbsolute(input.path)) {
    throw new WorkbenchCliError('absolute_path_required', '请求 JSON 的 path 必须是本机绝对路径。', 'not_applied')
  }
  return { action: 'local-capability', input }
}
