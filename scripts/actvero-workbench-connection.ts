/** Local development CLI transport; it never launches or restarts Harness. */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { WorkbenchDevelopmentId } from '../packages/actvero/capability-ui/src/types.ts'
const connectionSchema = z.object({ schemaVersion: z.literal(1), url: z.url(), token: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough()
const attachmentSchema = z.object({
  connection: z.string(), id: z.string().uuid().transform(value => value as WorkbenchDevelopmentId),
}).strict()

/** Send an authenticated command only to the loopback endpoint exported by Harness.
 * @param connectionFile Private connection file exported by the target profile.
 * @param command Development operation; no platform credentials are transmitted.
 * @param signal Optional caller cancellation.
 * @returns Validated JSON result; transport and operation failures reject with diagnostics.
 */
export async function developmentRequest(connectionFile: string, command: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const connection = connectionSchema.parse(JSON.parse(await readFile(connectionFile, 'utf8')))
  const url = new URL(connection.url)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('开发连接必须指向本机 Harness。')
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' }, body: JSON.stringify(command), redirect: 'error', ...(signal ? { signal } : {}) })
  if (response.status === 403) throw new Error('Development connection expired or was denied; export a new connection from the target Harness.')
  const result = z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), value: z.unknown() }), z.object({ ok: z.literal(false), diagnostic: z.string() })]).parse(await response.json())
  if (!result.ok) throw new Error(result.diagnostic)
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
  const attachment = attachmentSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  const result = await developmentRequest(attachment.connection, { action, id: attachment.id })
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
  return (artifact, signal) => developmentRequest(attachment.connection, { action: 'apply', id: attachment.id, ...artifact }, signal)
}
