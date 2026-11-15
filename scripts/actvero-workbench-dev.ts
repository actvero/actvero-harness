/** Serialized watch builds and machine-readable diagnostics for external development Agents. */
import { watch } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Observe edits until cancellation; a successful build reports an artifact, never claims runtime activation.
 * @param directory Author-owned project directory.
 * @param build Build and validate one archive, returning its absolute path and content digest.
 * @param signal Stops observation and waits for an already-started build.
 */
export async function watchWorkbench(
  directory: string, build: () => Promise<{ path: string; sha256: string }>, signal: AbortSignal,
): Promise<void> {
  await mkdir(join(directory, '.actvero'), { recursive: true })
  let generation = 0
  let pending = false
  let running: Promise<void> | undefined
  let finish!: () => void
  let fail!: (error: unknown) => void
  const stopped = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
  const publish = async (result: object) => {
    const value = JSON.stringify({ schemaVersion: 1, generation, ...result }) + '\n'
    const temporary = join(directory, '.actvero/diagnostics.tmp')
    await writeFile(temporary, value)
    await rename(temporary, join(directory, '.actvero/diagnostics.json'))
    process.stdout.write(value)
  }
  const rebuild = () => {
    pending = true
    if (running) return
    running = (async () => {
      while (pending && !signal.aborted) {
        pending = false
        generation++
        await publish({ phase: 'building' })
        try {
          const artifact = await build()
          await publish({ phase: 'built', artifact, runtime: 'not-verified' })
        } catch (error) {
          await publish({ phase: 'failed', diagnostic: error instanceof Error ? error.message : String(error) })
        }
      }
    })().catch(fail).finally(() => { running = undefined })
  }
  const watcher = watch(directory, { recursive: true }, (_event, file) => {
    if (file && !file.split(/[\\/]/u).some(part => ['.git', '.actvero', 'node_modules', 'dist'].includes(part))) rebuild()
  })
  const stop = () => { watcher.close(); finish() }
  watcher.once('error', fail)
  signal.addEventListener('abort', stop, { once: true })
  try {
    if (signal.aborted) stop()
    else rebuild()
    await stopped
  } finally {
    watcher.close()
    signal.removeEventListener('abort', stop)
    await running
  }
}
