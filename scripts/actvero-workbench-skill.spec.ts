/** Developer resources remain readable after distribution without the source tree. */
import { cp, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { generateWorkbenchSkillReference } from './actvero-workbench-skill.ts'
import { WORKBENCH_HOST_API_VERSION } from '../packages/actvero/capability-ui/src/workbench-protocol.ts'

it.each(['source-checkout', 'standalone-kit'] as const)('ships relocatable %s guidance with readable local links and exact API versions', async (toolchain) => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-developer-skill-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const skill = join(root, 'build')
  await cp(join(repository, 'packages/actvero/capability-ui/assets/develop-workbench/SKILL.md'), join(skill, 'SKILL.md'), { recursive: true })
  generateWorkbenchSkillReference(join(skill, 'reference'), toolchain)
  const installed = join(root, 'installed skill')
  await rename(skill, installed)
  const environment: { dshRuntimeVersion: string; workbenchHostApiVersion: string; toolchain: string; sources: Record<string, string>; sha256: Record<string, string> } = JSON.parse(await readFile(join(installed, 'reference/environment.json'), 'utf8'))
  const baseline: { version: string } = JSON.parse(await readFile(join(repository, 'actvero/upstream.lock.json'), 'utf8'))
  expect(environment.dshRuntimeVersion).toBe(baseline.version)
  expect(environment.workbenchHostApiVersion).toBe(WORKBENCH_HOST_API_VERSION)
  expect(environment.toolchain).toBe(toolchain)
  for (const [target, source] of Object.entries(environment.sources)) {
    const path = join(installed, 'reference', target)
    const text = await readFile(path, 'utf8')
    expect(createHash('sha256').update(text).digest('hex')).toBe(environment.sha256[target])
    if (target.endsWith('.ts')) expect(text).toBe(await readFile(join(repository, source), 'utf8'))
    if (target.endsWith('.md')) await assertLocalLinks(path, text)
  }
  const instructions = await readFile(join(installed, 'SKILL.md'), 'utf8')
  for (const [, path] of instructions.matchAll(/`(reference\/[^`]+)`/gu)) {
    if (path) await stat(join(installed, path))
  }
  await assertLocalLinks(join(installed, 'SKILL.md'), instructions)
})

async function assertLocalLinks(file: string, text: string): Promise<void> {
  for (const [, , href] of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(href)) continue
    const [path, anchor] = href.split('#')
    const target = join(dirname(file), path!)
    expect((await stat(target)).isFile()).toBe(true)
    if (anchor) expect(await readFile(target, 'utf8')).toContain(`id="${anchor}"`)
  }
}
