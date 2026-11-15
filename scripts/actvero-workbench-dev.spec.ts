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
