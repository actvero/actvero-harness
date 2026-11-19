/** Offline compiler extraction, concurrent cache ownership and non-destructive Skill installation. */
import { installDevelopmentSkills } from './actvero-development-skills.ts'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { expect, it, onTestFinished } from 'vitest'
import { ensureNpmWorkbenchKit, installWorkbenchSkills } from './actvero-workbench-npm-cli.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-npm-test-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const kit = join(root, 'input/kit')
  const distribution = join(root, 'package')
  await mkdir(join(kit, 'scripts'), { recursive: true })
  await mkdir(distribution)
  await writeFile(join(kit, 'scripts/actvero-workbench.client.mjs'), 'console.log("compiler fixture")\n')
  await writeFile(join(kit, 'workbench-kit.json'), JSON.stringify({ platform: process.platform, arch: process.arch, runtimeVersion: '0.2.1-rc.3' }))
  for (const name of ['develop-workbench', 'workbench-frontend', 'expert-creator']) {
    const directory = join(kit, 'packages/actvero/capability-ui/assets', name)
    await mkdir(join(directory, 'reference'), { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), `name: ${name}\n`)
    await writeFile(join(directory, 'reference/guide.md'), 'portable guidance\n')
  }
  await create({ cwd: join(root, 'input'), file: join(distribution, 'kit.tgz'), gzip: true, portable: true }, ['kit'])
  const release = { schemaVersion: 1, name: '@actvero/workbench-development-kit', version: '0.1.0-preview.1',
    platform: process.platform, arch: process.arch, runtimeVersion: '0.2.1-rc.3', hostApiVersion: '1.8.0',
    sha256: createHash('sha256').update(await readFile(join(distribution, 'kit.tgz'))).digest('hex') }
  await writeFile(join(distribution, 'release.json'), JSON.stringify(release))
  return { root, kit, distribution, release, cache: join(root, 'cache') }
}

it('shares a completed compiler across simultaneous invocations and removes temporary extraction directories', async () => {
  const { cache, distribution, release } = await fixture()
  const [first, second] = await Promise.all([ensureNpmWorkbenchKit(distribution, cache), ensureNpmWorkbenchKit(distribution, cache)])
  expect(first).toBe(second)
  expect(await readFile(join(first, '.npm-kit-ready'), 'utf8')).toBe(release.sha256)
  expect(await readdir(cache)).toEqual([release.sha256])
  expect(await ensureNpmWorkbenchKit(distribution, cache)).toBe(first)
})

it('rejects a damaged payload and a platform mismatch before creating a cache', async () => {
  const { cache, distribution, release } = await fixture()
  await writeFile(join(distribution, 'kit.tgz'), 'damaged archive')
  await expect(ensureNpmWorkbenchKit(distribution, cache)).rejects.toThrow('校验失败')
  await expect(readdir(cache)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(distribution, 'release.json'), JSON.stringify({ ...release, platform: process.platform === 'darwin' ? 'linux' : 'darwin' }))
  await expect(ensureNpmWorkbenchKit(distribution, cache)).rejects.toThrow('仅支持')
})

it('copies both Skills with their references and preserves an existing author Skill', async () => {
  const { root, kit } = await fixture()
  const destination = join(root, 'agent skills')
  const installed = await installWorkbenchSkills(kit, destination)
  expect(installed).toHaveLength(3)
  for (const path of installed) expect(await readFile(join(path, 'reference/guide.md'), 'utf8')).toBe('portable guidance\n')
  const custom = join(destination, 'develop-workbench/SKILL.md')
  await writeFile(custom, 'author instructions\n')
  await expect(installWorkbenchSkills(kit, destination)).rejects.toThrow('已存在')
  expect(await readFile(custom, 'utf8')).toBe('author instructions\n')
})


it('updates managed copies together and preserves any author modification', async () => {
  const { root, kit } = await fixture()
  const destination = join(root, 'global skills')
  await installDevelopmentSkills(kit, destination)
  await writeFile(join(kit, 'packages/actvero/capability-ui/assets/develop-workbench/SKILL.md'), 'updated guidance\n')
  await installDevelopmentSkills(kit, destination, true)
  expect(await readFile(join(destination, 'develop-workbench/SKILL.md'), 'utf8')).toBe('updated guidance\n')
  await writeFile(join(destination, 'expert-creator/SKILL.md'), 'my instructions\n')
  await expect(installDevelopmentSkills(kit, destination, true)).rejects.toThrow('已被修改')
  expect(await readFile(join(destination, 'expert-creator/SKILL.md'), 'utf8')).toBe('my instructions\n')
})


it('preserves a managed Skill that the user replaced with a directory link', async () => {
  const { root, kit } = await fixture()
  const destination = join(root, 'skills')
  await installDevelopmentSkills(kit, destination)
  const original = join(destination, 'expert-creator')
  const linked = join(root, 'my-expert-creator')
  await rename(original, linked)
  await symlink(linked, original, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(installDevelopmentSkills(kit, destination, true)).rejects.toThrow('user-owned link')
  expect((await lstat(original)).isSymbolicLink()).toBe(true)
  expect(await readFile(join(linked, 'SKILL.md'), 'utf8')).toContain('expert-creator')
})
