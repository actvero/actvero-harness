/** Workbench Host runtime; the client entry owns capability navigation. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { WorkbenchRuntime, type WorkbenchRuntimeConfig } from './workbench-runtime.ts'
import { workbenchDomain } from './workbench-storage.ts'

export type * from './types.ts'
export type * from './workbench-provider.ts'
export { WorkbenchRuntime } from './workbench-runtime.ts'
/** Services required by business storage and native conversation integration. */
export const inject = ['agents', 'sessionController', 'sessionProjections', 'tools', 'systemPrompt', 'storageDomain', 'typert', 'remoteAccess', 'workspaceRegistry']
/** Deployment-owned managed files location. */
export const Config: z<WorkbenchRuntimeConfig> = z.object({ dataDirectory: z.string().required() })
/** Open authoritative data before advertising runtime availability.
 * @param ctx Host plugin scope.
 * @param config Managed files location supplied by the product profile.
 * @returns Completion when the workbench runtime is ready.
 */
export async function apply(ctx: Context, config: WorkbenchRuntimeConfig): Promise<void> {
  const domain = await ctx.storageDomain.open(workbenchDomain)
  ctx.effect(() => () => domain.close())
  new WorkbenchRuntime(ctx, domain, config)
}
