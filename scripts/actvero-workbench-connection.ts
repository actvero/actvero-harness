/** Local development CLI transport; it never launches or restarts Harness. */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { WorkbenchDevelopmentId } from '../packages/actvero/capability-ui/src/types.ts'
import { readCliJson, WorkbenchCliError } from './actvero-workbench-cli-result.ts'
const connectionSchema = z.object({ schemaVersion: z.literal(1), url: z.url(), token: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough()
const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: z.json() }),
  z.object({ ok: z.literal(false), diagnostic: z.string() }),
])
const attachmentSchema = z.object({
  connection: z.string(), id: z.string().uuid().transform(value => value as WorkbenchDevelopmentId),
}).strict()
const reconnect = '在目标 Harness 的「交给其他 Agent」中重新导出开发连接文件。'
const rejectedBeforeWrite = new Set([
  'invalid_input', 'local_changes', 'skill_name_conflict', 'connector_edit_conflict', 'expert_edit_conflict',
  'credential_review_required', 'connector_incompatible_fields', 'name_conflict', 'local_capability_unavailable', 'operation_in_progress',
])
const diagnostics: Readonly<Record<string, string>> = {
  local_changes: 'Skill 版本或安装文件已发生变化。',
  connector_edit_conflict: 'MCP 配置已发生变化。',
  expert_edit_conflict: '专家修订号已发生变化。',
  local_capability_outcome_unknown: 'Harness 没有确认操作结果。',
  local_capability_unavailable: '目标 Harness 当前无法管理本机能力。请检查版本或重新导出连接。',
  credential_review_required: '请在连接器页面核对凭据和新的连接目标后再编辑。',
  connector_incompatible_fields: '修改包含与目标传输方式不兼容的字段。请按当前配置和命令 schema 修正请求。',
  command_not_found: '找不到 MCP 的启动程序。请检查 command 指向的路径。',
  authorization_required: '请先在 Harness 连接器页面完成授权。',
}

/** Send an authenticated command only to the loopback endpoint exported by Harness.
 * @param connectionFile Private connection file exported by the target profile.
 * @param command Development operation; no platform credentials are transmitted.
 * @param signal Optional caller cancellation.
 * @param options Outcome classification and a safe readback procedure.
 * @returns Validated JSON result; transport and operation failures reject with diagnostics.
 */
export async function developmentRequest(connectionFile: string, command: Record<string, unknown>, signal?: AbortSignal,
  options: { readOnly?: boolean; recovery?: string | undefined } = {}): Promise<unknown> {
  const parsedConnection = connectionSchema.safeParse(await readCliJson(connectionFile, 'connection'))
  if (!parsedConnection.success) throw new WorkbenchCliError('invalid_connection', '开发连接文件格式无效。', 'not_applied', reconnect)
  const connection = parsedConnection.data
  const url = new URL(connection.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new WorkbenchCliError('invalid_connection', '开发连接必须指向本机 Harness。', 'not_applied', reconnect)
  }
  const budget = AbortSignal.timeout(125_000)
  const deadline = signal ? AbortSignal.any([signal, budget]) : budget
  if (deadline.aborted) throw new WorkbenchCliError('request_cancelled', '请求发送前已取消。', 'not_applied')
  const outcome = options.readOnly ? 'not_applied' : 'unknown'
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token,
      'Content-Type': 'application/json' }, body: JSON.stringify(command), redirect: 'error', signal: deadline })
  } catch (_error) {
    const code = budget.aborted ? 'request_timeout' : deadline.aborted ? 'request_cancelled' : 'connection_failed'
    throw new WorkbenchCliError(code, '未收到 Harness 的确认。', outcome, options.recovery ?? reconnect)
  }
  if (response.status === 403) throw new WorkbenchCliError('connection_denied', 'Harness 拒绝了当前的开发连接。', 'not_applied', reconnect)
  let body: unknown
  try { body = await response.json() }
  catch (_error) { throw new WorkbenchCliError('invalid_response', '未收到完整的 Harness JSON 响应。', outcome, options.recovery ?? reconnect) }
  const parsed = responseSchema.safeParse(body)
  if (!parsed.success) throw new WorkbenchCliError('invalid_response', 'Harness 响应与预期格式不一致。', outcome, options.recovery ?? reconnect)
  const result = parsed.data
  if (!result.ok) {
    const code = /^[a-z][a-z0-9_]{0,79}$/u.test(result.diagnostic) ? result.diagnostic : 'harness_rejected'
    const message = Object.hasOwn(diagnostics, code) ? diagnostics[code] ?? result.diagnostic : result.diagnostic
    throw new WorkbenchCliError(code, message,
      rejectedBeforeWrite.has(code) ? 'not_applied' : outcome, options.recovery)
  }
  return result.value
}

/** Bind an author-owned project to one running profile without installing or changing a release.
 * @param directory Project containing package.json.
 * @param connectionFile Private connection file from the target Harness.
 * @returns Attachment identity, also persisted under .actvero for watch builds.
 */
export async function attachWorkbench(directory: string, connectionFile: string): Promise<{ id: WorkbenchDevelopmentId; name: string }> {
  const connection = resolve(connectionFile)
  const value = z.object({ id: z.string().uuid().transform(value => value as WorkbenchDevelopmentId), name: z.string() }).parse(await developmentRequest(connection, { action: 'attach', directory: resolve(directory) }))
  await mkdir(join(directory, '.actvero'), { recursive: true })
  try { await writeFile(join(directory, '.actvero/development.json'), JSON.stringify({ connection, id: value.id }) + '\n', { mode: 0o600 }) }
  catch (error) { await developmentRequest(connection, { action: 'detach', id: value.id }); throw error }
  return value
}

/** Query an attached project, or release its overlay and restore its installed version.
 * @param directory Attached project.
 * @param action status reads bounded deployment diagnostics; detach releases the overlay.
 * @returns Host outcome; detach removes the local attachment only after confirmed release.
 */
export async function inspectDevelopment(directory: string, action: 'status' | 'detach'): Promise<unknown> {
  const path = join(directory, '.actvero/development.json')
  const attachment = attachmentSchema.parse(await readCliJson(path, 'attachment'))
  const result = await developmentRequest(attachment.connection, { action, id: attachment.id }, undefined, { readOnly: action === 'status' })
  if (action === 'detach') await rm(path)
  return result
}

/** Load an optional project attachment. Absence keeps ordinary watch builds offline.
 * @param directory Project being watched.
 * @returns An apply callback when attached, otherwise undefined.
 */
export async function developmentApplier(directory: string):
Promise<((artifact: { path: string; sha256: string }, signal: AbortSignal) => Promise<unknown>) | undefined> {
  let data: string
  try { data = await readFile(join(directory, '.actvero/development.json'), 'utf8') }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined; throw error }
  const attachment = attachmentSchema.parse(JSON.parse(data))
  return ({ path: archive, sha256 }, signal) =>
    developmentRequest(attachment.connection, { action: 'apply', id: attachment.id, path: archive, sha256 }, signal)
}
