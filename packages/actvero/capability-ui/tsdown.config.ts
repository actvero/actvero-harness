import { mkdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'
const reference = fileURLToPath(new URL('./assets/develop-workbench/reference/', import.meta.url))
mkdirSync(reference, { recursive: true })
for (const language of ['', '.zh']) {
  copyFileSync(new URL(`../../../actvero/workbench-development${language}.md`, import.meta.url), `${reference}/guide${language}.md`)
}
export default clientBundle(import.meta.dirname, ['lib/types/contracts.js', 'lib/types/index.js'], { hostPhase: true })
