import { clientBundle } from '../../client/tsdown.client.ts'
export default clientBundle(import.meta.dirname, ['lib/types/index.js', 'lib/types/contracts.js'], { hostPhase: true })
