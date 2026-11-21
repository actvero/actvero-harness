/** Machine-readable results and diagnostics for the npm launcher and the standalone compiler. */
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

/** Whether a failed call may have applied changes or started a connection. */
export type CliOutcome = 'not_applied' | 'unknown'

/** Common failure output for `--json`; recovery is written for the selected operation. */
export const cliFailureSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.string(), ok: z.literal(false),
  error: z.strictObject({
    code: z.string(), message: z.string(), outcome: z.enum(['not_applied', 'unknown']),
    recovery: z.string().optional(), issues: z.array(z.strictObject({ field: z.string(), message: z.string() })).optional(),
  }),
})

/** A safely classified CLI failure with a recovery step for the caller. */
export class WorkbenchCliError extends Error {
  constructor(readonly code: string, message: string, readonly outcome: CliOutcome,
    readonly recovery?: string, readonly issues?: readonly { field: string; message: string }[]) {
    super(message)
  }
}

/** Read a JSON document with separate file and syntax diagnostics.
 * @param path Local path supplied to the command.
 * @param kind Whether the file contains a request or a connection.
 * @returns The decoded value, before command-specific validation.
 */
export async function readCliJson(path: string, kind: 'request' | 'connection'): Promise<unknown> {
  let raw: string
  try { raw = await readFile(path, 'utf8') }
  catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    throw new WorkbenchCliError(missing ? kind + '_file_not_found' : kind + '_file_unreadable',
      `无法读取 ${kind} 文件 ${path}。`, 'not_applied',
      kind === 'connection' ? '在目标 Harness 中重新导出开发连接文件。' : '核对文件路径和读取权限。')
  }
  if (kind === 'request' && raw.length > 950_000) {
    throw new WorkbenchCliError('request_too_large', '请求文件超过大小限制。', 'not_applied')
  }
  try { return JSON.parse(raw) }
  catch (_error) {
    throw new WorkbenchCliError(kind + '_invalid_json', `${kind} 文件包含无效的 JSON。`, 'not_applied',
      kind === 'connection' ? '从目标 Harness 重新导出连接文件。' : '修正 JSON 语法后重试。')
  }
}

/** Check an operation's result independently of input validation.
 * @param schema Expected result schema declared by the command.
 * @param value Result returned by the owner of the operation.
 * @param readOnly Whether the operation could have changed state or started a connection.
 * @param recovery How to inspect the owner's current state.
 * @returns The caller-visible result without rewriting fields.
 */
export function validateCliResult(schema: z.ZodType, value: unknown, readOnly: boolean, recovery?: string): unknown {
  if (!schema.safeParse(value).success) {
    throw new WorkbenchCliError('invalid_result', '命令返回与输出 schema 不一致。', readOnly ? 'not_applied' : 'unknown', recovery)
  }
  return value
}

/** Validate a caller's JSON before sending any request to Harness.
 * @param schema Request schema declared by the command.
 * @param value Decoded request body.
 * @returns Validated input, or a diagnostic identifying the invalid fields.
 */
export function parseCliInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issues = result.error.issues.map(item => ({ field: item.path.map(String).join('.'), message: item.message }))
  throw new WorkbenchCliError('invalid_input', '输入不符合命令 schema。', 'not_applied', undefined, issues)
}

/** Write a successful command result, retaining text output for interactive use.
 * @param command Catalog name of the command that ran.
 * @param result Validated command result.
 * @param machine Whether to print a single-line JSON envelope.
 * @param message Optional human-facing success text.
 */
export function printCliResult(command: string, result: unknown, machine: boolean, message?: string): void {
  console.log(machine ? JSON.stringify({ schemaVersion: 1, command, ok: true, result })
    : message ?? JSON.stringify(result, null, 2))
}

/** Report one failure without asking a caller to infer its identity from message text.
 * @param error Failure from argument parsing, the compiler or Harness.
 * @param command Catalog name, when available.
 * @param machine Whether to use the JSON result channel.
 * @param recovery Safe next action for this command.
 */
export function printCliFailure(error: unknown, command: string, machine: boolean, recovery?: string): void {
  const issue = error instanceof WorkbenchCliError ? error
    : new WorkbenchCliError('command_failed', error instanceof Error ? error.message : String(error), 'unknown')
  const { code, message, outcome, issues } = issue
  const next = issue.recovery ?? recovery
  if (machine) {
    const result = cliFailureSchema.parse({
      schemaVersion: 1, command, ok: false,
      error: { code, message, outcome, ...(next ? { recovery: next } : {}), ...(issues ? { issues } : {}) },
    })
    console.log(JSON.stringify(result))
  } else console.error([message, issues?.map(item => `${item.field || '请求'} ${item.message}`).join('\n'), next].filter(Boolean).join('\n'))
  process.exitCode = 1
}
