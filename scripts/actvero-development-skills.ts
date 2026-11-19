/** Transactional installation of the developer kit's shared Agent Skills. */
import { cp, mkdir, mkdtemp, lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
const names = ['develop-workbench', 'workbench-frontend', 'expert-creator'] as const
const marker = '.actvero-managed.json'
const managedSchema = z.object({ owner: z.literal('actvero-development-kit'), files: z.record(z.string(), z.string()) }).strict()
async function hashes(directory: string, prefix = ''): Promise<Record<string, string>> {
  if (!prefix && (await lstat(directory)).isSymbolicLink()) throw new Error(`Skill directory is a user-owned link; preserving it: ${directory}`)
  const result: Record<string, string> = Object.create(null)
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name
    if (path === marker) continue
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, path))
    else if (entry.isFile()) result[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex')
    else throw new Error(`Skill 包含链接或特殊文件，保持原样：${join(directory, path)}`)
  }
  return result
}

/** Install all shared authoring Skills, or update only unmodified tool-managed copies.
 * @param kit Exact compiler kit containing the three Skill directories.
 * @param destination Collection directory, usually ~/.agents/skills.
 * @param update True permits replacing copies carrying an unchanged management manifest; false rejects existing targets.
 * @returns Installed Skill paths after every replacement succeeds; failures restore previous directories.
 */
export async function installDevelopmentSkills(kit: string, destination: string, update = false): Promise<string[]> {
  destination = resolve(destination)
  await mkdir(destination, { recursive: true })
  const lock = join(destination, '.actvero-skills-lock')
  try { await mkdir(lock) } catch (error) { throw new Error('另一个 Skill 安装正在运行；请稍后重试。', { cause: error }) }
  let temporary: string | undefined
  const previous: string[] = [], installed: string[] = []
  try {
    temporary = await mkdtemp(join(destination, '.actvero-skills-'))
    for (const name of names) {
      const target = join(destination, name)
      try {
        const actual = await hashes(target)
        if (!update) throw new Error(`已存在 ${target}；使用 skills update 更新本工具管理的副本。`)
        const managed = managedSchema.parse(JSON.parse(await readFile(join(target, marker), 'utf8')))
        if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(managed.files).sort())) throw new Error(`Skill 已被修改，保留用户内容：${target}`)
        previous.push(name)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        // A present directory without our marker belongs to its author, even during update.
        try { await readdir(target); throw new Error(`Skill 不是本工具管理的副本，保留原样：${target}`) }
        catch (missing) { if (!(missing instanceof Error && 'code' in missing && missing.code === 'ENOENT')) throw missing }
      }
      const staged = join(temporary, name)
      await cp(join(kit, 'packages/actvero/capability-ui/assets', name), staged, { recursive: true })
      await writeFile(join(staged, marker), JSON.stringify({ owner: 'actvero-development-kit', files: await hashes(staged) }) + '\n')
    }
    for (const name of names) {
      const target = join(destination, name)
      if (previous.includes(name)) await rename(target, join(temporary, name + '.previous'))
      try { await rename(join(temporary, name), target) }
      catch (error) { if (previous.includes(name)) await rename(join(temporary, name + '.previous'), target); throw error }
      installed.push(name)
    }
    return installed.map(name => join(destination, name))
  } catch (error) {
    for (const name of installed.reverse()) {
      await rm(join(destination, name), { recursive: true, force: true })
      if (temporary && previous.includes(name)) await rename(join(temporary, name + '.previous'), join(destination, name))
    }
    throw error
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
    await rm(lock, { recursive: true })
  }
}
