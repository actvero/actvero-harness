import { clientBundle } from '../../client/tsdown.client.ts'
export default clientBundle(import.meta.dirname, ["lib/types/main.js", "lib/types/contracts.js", "lib/types/local-config.js", "lib/types/index.js", "lib/types/local-mcp.js", "lib/types/local-oauth.js"], {hostPhase:true})
