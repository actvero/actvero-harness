import { clientBundle } from '../../client/tsdown.client.ts'
export default clientBundle(import.meta.dirname, ["lib/types/main.js", "lib/types/contracts.js", "lib/types/local.js", "lib/types/index.js", "lib/types/package.js"], {hostPhase:true})
