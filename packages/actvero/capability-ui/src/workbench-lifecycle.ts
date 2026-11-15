/** Versioned business-data preparation, independent of npm installation scripts. */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { WorkbenchEnvironment } from './types.ts'

/** Optional business-data hooks. They run in the Host and must finish owned work before settling. */
export interface WorkbenchLifecycle {
  /** Monotonic business-data version, independent of the package version. */
  dataVersion: number
  /** Initialize on first open, including adoption of existing data without a lifecycle marker. Must be idempotent. */
  initialize?(environment: WorkbenchEnvironment, signal: AbortSignal): Promise<void>
  /** Upgrade from the last completed data version; required when that version changes. Must be restartable after failure. */
  migrate?(environment: WorkbenchEnvironment, fromVersion: number, signal: AbortSignal): Promise<void>
  /** Clean author-owned resources after explicit consent, before package removal.
   * Never show UI; partial effects are not rolled back.
   */
  cleanup?(environment: WorkbenchEnvironment, signal: AbortSignal): Promise<void>
}

const markerSchema = z.object({ dataVersion: z.number().int().nonnegative() }).strict()

/** Prepare one instance and persist its marker only after the hook succeeds. The caller serializes access.
 * @param hooks Provider-owned lifecycle declaration.
 * @param environment Host-managed instance location.
 * @param signal Provider lifetime; hooks must honor cancellation.
 */
export async function prepareWorkbenchData(
  hooks: WorkbenchLifecycle, environment: WorkbenchEnvironment, signal: AbortSignal,
): Promise<void> {
  const file = join(environment.dataDirectory, '.actvero-data-version.json')
  let previous: number | undefined
  try { previous = markerSchema.parse(JSON.parse(await readFile(file, 'utf8'))).dataVersion } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  signal.throwIfAborted()
  if (previous === hooks.dataVersion) return
  if (previous !== undefined && previous > hooks.dataVersion) throw new Error('Workbench data cannot be downgraded')
  if (previous === undefined) await hooks.initialize?.(environment, signal)
  else {
    if (!hooks.migrate) throw new Error('Workbench data migration is required')
    await hooks.migrate(environment, previous, signal)
  }
  signal.throwIfAborted()
  const temporary = file + '.tmp'
  await writeFile(temporary, JSON.stringify({ dataVersion: hooks.dataVersion }) + '\n')
  signal.throwIfAborted()
  await rename(temporary, file)
}
