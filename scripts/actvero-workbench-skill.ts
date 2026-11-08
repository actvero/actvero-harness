/** Build portable developer-Skill references from the same checkout as the runtime. */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const sources = {
  'guide.md': 'actvero/workbench-development.md',
  'guide.zh.md': 'actvero/workbench-development.zh.md',
  'api/client.ts': 'packages/actvero/capability-ui/src/contracts.ts',
  'api/provider.ts': 'packages/actvero/capability-ui/src/workbench-provider.ts',
  'api/types.ts': 'packages/actvero/capability-ui/src/types.ts',
  'api/expert.ts': 'packages/actvero/experts/src/contracts.ts',
} as const

/** Generate read-only guide and API snapshots; repository-only links remain explicit source locations.
 * @param destination Disposable generated reference directory owned by the caller.
 */
export function generateWorkbenchSkillReference(destination: string): void {
  const baseline: { version: string } = JSON.parse(readFileSync(join(repository, 'actvero/upstream.lock.json'), 'utf8'))
  const capability: { version: string } = JSON.parse(readFileSync(join(repository, 'packages/actvero/capability-ui/package.json'), 'utf8'))
  const experts: { version: string } = JSON.parse(readFileSync(join(repository, 'packages/actvero/experts/package.json'), 'utf8'))
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const [target, source] of Object.entries(sources)) {
    const output = join(destination, target)
    mkdirSync(dirname(output), { recursive: true })
    if (!target.endsWith('.md')) { copyFileSync(join(repository, source), output); continue }
    const label = target.endsWith('.zh.md') ? '源码仓库' : 'source checkout'
    const guide = readFileSync(join(repository, source), 'utf8').replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (link: string, title: string, href: string) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(href)) return link
      const fragmentStart = href.indexOf('#')
      const path = fragmentStart === -1 ? href : href.slice(0, fragmentStart)
      const resolved = posix.normalize(posix.join(posix.dirname(source), path))
      const bundled = Object.entries(sources).find(([, original]) => original === resolved)?.[0]
      const suffix = fragmentStart === -1 ? '' : href.slice(fragmentStart)
      return bundled ? `[${title}](${bundled}${suffix})` : `${title}（${label}：\`${resolved}${suffix}\`）`
    })
    writeFileSync(output, guide)
  }
  writeFileSync(join(destination, 'environment.json'), JSON.stringify({
    schemaVersion: 1, workbenchFormat: 1, dshRuntimeVersion: baseline.version,
    packages: { '@actvero/dsh-capability-ui': capability.version, '@actvero/dsh-experts': experts.version },
    toolchain: 'source-checkout', sources,
    sha256: Object.fromEntries(Object.keys(sources).map(target => [target, createHash('sha256').update(readFileSync(join(destination, target))).digest('hex')])),
  }, null, 2) + '\n')
}
