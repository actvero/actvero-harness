import { clientBundle } from '../../client/tsdown.client.ts'
export default clientBundle(import.meta.dirname, ["lib/types/schema.js", "lib/types/main.js", "lib/types/creator.js", "lib/types/contracts.js", "lib/types/remote-main.js", "lib/types/remote-contract.js", "lib/types/remote-types.js", "lib/types/categories.js", "lib/types/projection.js", "lib/types/index.js"], {hostPhase:true})
