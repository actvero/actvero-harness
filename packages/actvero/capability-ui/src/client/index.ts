import type { Context } from '@deepseek-ai/cordis'
import { apply as applyCapabilityHub, inject as capabilityHubDependencies } from './Manager.tsx'
import { registerWorkbenches } from './workbenches/register.ts'
import remote from '@actvero/dsh-capability-ui/remote'

export const inject = [...capabilityHubDependencies, 'remote.pluginManager', 'resources', 'uiWorkspace', 'commandUi', 'sessions']

/** Mount Actvero’s capability center and local workbench management.
 * @param ctx Client plugin scope.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  applyCapabilityHub(ctx)
  const unmount = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.actveroWorkbench', 'remote.actveroWorkbenchPlatform'], (child) => { registerWorkbenches(child) })
  try { await ui } catch (error) { await ui.dispose(); await unmount(); throw error }
  return async () => { await ui.dispose(); await unmount() }
}

export { CatalogSkeleton,DetailLoading } from './loading.ts'

export { CardMenu } from './card-menu.tsx'
export type { CardMenuProps } from './card-menu.tsx'
