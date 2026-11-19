import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'
import { creatorSkill } from '../experts/src/creator.ts'
import { generateWorkbenchSkillReference } from '../../../scripts/actvero-workbench-skill.ts'
const reference = fileURLToPath(new URL('./assets/develop-workbench/reference/', import.meta.url))
generateWorkbenchSkillReference(reference)
const assets = join(import.meta.dirname, 'assets')
const guidance: Record<string, string> = {}
function collect(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (entry.isFile()) guidance[relative(assets, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8')
  }
}
collect(assets)
guidance['expert-creator/SKILL.md'] = `---\nname: ${creatorSkill.name}\ndescription: ${JSON.stringify(creatorSkill.description)}\n---\n\n${creatorSkill.content}`
const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })
export default (options: Parameters<typeof bundle>[0]) => bundle(options).map(config => ({
  ...config, define: { ...config.define, ACTVERO_WORKBENCH_GUIDANCE: JSON.stringify(guidance) },
}))
