/** Watch diagnostics distinguish artifact builds, failures and actual runtime activation. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { watchWorkbench } from './actvero-workbench-dev.ts'

it('serializes edits and replaces failed diagnostics after recovery without claiming a loaded runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actvero-dev-watch-'))
  const controller = new AbortController()
  const build = vi.fn(async () => {
    const code = await readFile(join(directory, 'input.txt'), 'utf8')
    if (code === 'broken') throw new Error('input.txt: invalid code')
    return { path: '/artifact.tgz', sha256: code }
  })
  await writeFile(join(directory, 'input.txt'), 'initial')
  const watching = watchWorkbench(directory, build, controller.signal).then(() => undefined, (error: unknown) => error)
  onTestFinished(async () => {
    controller.abort()
    expect(await watching).toBeUndefined()
    await rm(directory, { recursive: true, force: true })
  })
  const diagnostics = async (): Promise<unknown> => JSON.parse(await readFile(join(directory, '.actvero/diagnostics.json'), 'utf8'))
  await vi.waitFor(async () => { expect(await diagnostics()).toMatchObject({ phase: 'built', runtime: 'not-verified', artifact: { sha256: 'initial' } }) })
  await writeFile(join(directory, 'input.txt'), 'broken')
  await vi.waitFor(async () => { expect(await diagnostics()).toMatchObject({ phase: 'failed', diagnostic: 'input.txt: invalid code' }) })
  await writeFile(join(directory, 'input.txt'), 'recovered')
  await vi.waitFor(async () => { expect(await diagnostics()).toMatchObject({ phase: 'built', artifact: { sha256: 'recovered' } }) })
  controller.abort()
  expect(await watching).toBeUndefined()
  const count = build.mock.calls.length
  await writeFile(join(directory, 'input.txt'), 'after-stop')
  expect(build).toHaveBeenCalledTimes(count)
})

it('waits for the attached Harness to become idle and reports its activation acknowledgement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actvero-dev-attached-'))
  const controller = new AbortController()
  let admit = false
  const apply = vi.fn(async (_artifact: { path: string; sha256: string }, _signal: AbortSignal) =>
    admit ? { application: 'applied', runtime: 'loaded', client: 'published' } : { application: 'busy' })
  const build = vi.fn(async () => ({ path: '/artifact.tgz', sha256: 'attached-build' }))
  const watching = watchWorkbench(directory, build, controller.signal, apply)
  onTestFinished(async () => { controller.abort(); await watching; await rm(directory, { recursive: true, force: true }) })
  const diagnostics = async (): Promise<unknown> => JSON.parse(await readFile(join(directory, '.actvero/diagnostics.json'), 'utf8'))
  await vi.waitFor(async () => { expect(await diagnostics()).toMatchObject({ phase: 'built', runtime: 'waiting-for-idle' }) })
  admit = true
  await vi.waitFor(async () => { expect(await diagnostics()).toMatchObject({ phase: 'built', runtime: 'loaded', client: 'published' }) }, { timeout: 3000 })
  expect(apply).toHaveBeenCalledWith({ path: '/artifact.tgz', sha256: 'attached-build' }, controller.signal)
  expect(apply.mock.calls.length).toBeGreaterThanOrEqual(2)
})

it('rejects an applied response without a loaded runtime acknowledgement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'actvero-dev-invalid-ack-'))
  const controller = new AbortController()
  const watching = watchWorkbench(directory, async () => ({ path: '/artifact.tgz', sha256: 'invalid-ack' }), controller.signal,
    async () => ({ application: 'applied', runtime: 'not-verified', client: 'published' }))
  onTestFinished(async () => { controller.abort(); await watching; await rm(directory, { recursive: true, force: true }) })
  await vi.waitFor(async () => {
    const diagnostic: unknown = JSON.parse(await readFile(join(directory, '.actvero/diagnostics.json'), 'utf8'))
    expect(diagnostic).toMatchObject({ phase: 'failed' })
    expect(diagnostic).not.toHaveProperty('runtime', 'loaded')
  })
})
