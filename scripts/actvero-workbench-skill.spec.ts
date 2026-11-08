/** Developer resources remain readable after distribution without the source tree. */
import { cp, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { generateWorkbenchSkillReference } from './actvero-workbench-skill.ts'

it('ships a versioned, relocatable Skill with readable local links and exact API sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'actvero-developer-skill-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const skill = join(root, 'build')
  await cp(join(repository, 'packages/actvero/capability-ui/assets/develop-workbench/SKILL.md'), join(skill, 'SKILL.md'), { recursive: true })
  generateWorkbenchSkillReference(join(skill, 'reference'))
  const installed = join(root, 'installed skill')
  await rename(skill, installed)
  const environment: { dshRuntimeVersion: string; toolchain: string; sources: Record<string, string>; sha256: Record<string, string> } = JSON.parse(await readFile(join(installed, 'reference/environment.json'), 'utf8'))
  const baseline: { version: string } = JSON.parse(await readFile(join(repository, 'actvero/upstream.lock.json'), 'utf8'))
  expect(environment.dshRuntimeVersion).toBe(baseline.version)
  expect(environment.toolchain).toBe('source-checkout')
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
    expect((await stat(join(dirname(file), href.split('#')[0]!))).isFile()).toBe(true)
  }
}
