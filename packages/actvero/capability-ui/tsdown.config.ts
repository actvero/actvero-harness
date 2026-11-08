import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'
import { generateWorkbenchSkillReference } from '../../../scripts/actvero-workbench-skill.ts'
const reference = fileURLToPath(new URL('./assets/develop-workbench/reference/', import.meta.url))
generateWorkbenchSkillReference(reference)
export default clientBundle(import.meta.dirname, ['lib/types/contracts.js', 'lib/types/index.js'], { hostPhase: true })
