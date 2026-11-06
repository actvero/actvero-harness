import type { Context } from '@deepseek-ai/cordis'
import { apply as applyCapabilityHub, inject as capabilityHubDependencies } from './Manager.tsx'
import { registerWorkbenches } from './workbenches/register.ts'

export const inject = [...capabilityHubDependencies, 'remote.pluginManager']

/** Mount Actvero’s capability center and local workbench management.
 * @param ctx Client plugin scope.
 */
export function apply(ctx: Context): void {
  applyCapabilityHub(ctx)
  registerWorkbenches(ctx)
}

export { CatalogSkeleton,DetailLoading } from './loading.ts'

export { CardMenu } from './card-menu.tsx'
export type { CardMenuProps } from './card-menu.tsx'
