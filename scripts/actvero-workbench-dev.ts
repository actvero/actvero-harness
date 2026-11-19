/** Serialized watch builds and machine-readable diagnostics for external development Agents. */
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { watch } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Observe edits until cancellation; an attached runtime reports activation separately from artifact creation.
 * @param directory Author-owned project directory.
 * @param build Build and validate one archive, returning its absolute path and content digest.
 * @param signal Stops observation and waits for an already-started build.
 * @param apply Optional connected Harness activation; busy responses wait for the active task to finish.
 */
export async function watchWorkbench(
  directory: string, build: () => Promise<{ path: string; sha256: string }>, signal: AbortSignal,
  apply?: (artifact: { path: string; sha256: string }, signal: AbortSignal) => Promise<unknown>,
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
          await publish({ phase: 'built', artifact, runtime: apply ? 'applying' : 'not-verified' })
          if (apply) {
            for (;;) {
              const result = z.discriminatedUnion('application', [
                z.object({ application: z.literal('busy') }),
                z.object({ application: z.literal('applied'), runtime: z.literal('loaded'), client: z.literal('published') }),
              ]).parse(await apply(artifact, signal))
              if (result.application === 'applied') { await publish({ phase: 'built', artifact, runtime: result.runtime, client: result.client }); break }
              await publish({ phase: 'built', artifact, runtime: 'waiting-for-idle' })
              await delay(500, undefined, { signal })
            }
          }
        } catch (error) {
          if (signal.aborted) break
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
