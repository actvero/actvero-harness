/** Workbench Host runtime; the client entry owns capability navigation. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-skill'
import { fileURLToPath } from 'node:url'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { WorkbenchRuntime, type WorkbenchRuntimeConfig } from './workbench-runtime.ts'
import { workbenchDomain } from './workbench-storage.ts'
import { checklistProvider } from './checklist.ts'
import { WorkbenchPlatformAccess } from './workbench-platform.ts'

export type * from './types.ts'
export type * from './workbench-provider.ts'
export type { WorkbenchObjectId } from './workbench-reference.ts'
export type { WorkbenchReferenceSnapshot, WorkbenchReferenceInput } from './workbench-reference.ts'
export type { WorkbenchResult } from './workbench-result.ts'
export { workbenchResultMetadata, workbenchResultText } from './workbench-result.ts'
export type { WorkbenchProtocol } from './workbench-protocol.ts'
export { WorkbenchPlatformAccess } from './workbench-platform.ts'
export { WorkbenchRuntime } from './workbench-runtime.ts'
/** Services required by business storage and native conversation integration. */
export const inject = ['agents', 'sessionController', 'sessionProjections', 'tools', 'systemPrompt', 'storageDomain', 'typert', 'remoteAccess', 'workspaceRegistry']
/** Deployment-owned managed files location. */
export interface Config extends WorkbenchRuntimeConfig {
  /** Opt in to the local checklist used for development and acceptance. */
  exampleWorkbench: boolean
  /** Maximum wait for a Main-owned platform read. */
  platformTimeoutMs: number
}
export const Config: z<Config> = z.object({
  dataDirectory: z.string().required(),
  exampleWorkbench: z.boolean().default(false),
  displayTimeoutMs: z.number().step(1).min(1).max(600000).default(30000),
  platformTimeoutMs: z.number().step(1).min(1).max(600000).default(30000),
})
/** Open authoritative data before advertising runtime availability.
 * @param ctx Host plugin scope.
 * @param config Managed files location supplied by the product profile.
 * @returns Completion when the runtime and any explicitly enabled example are ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  ctx.inject(['skills'], (child) => {
    let provider!: FileSystemSkillProvider
    child.skills.registerProvider((control) => {
      provider = new FileSystemSkillProvider(child, control, {
        providerName: 'actvero-workbench-development', includeDefaultRoots: false, watch: false,
        bundledSkillDir: fileURLToPath(new URL('../assets/', import.meta.url)),
      })
      return provider
    })
    child.effect(() => () => provider.dispose())
  })
  const domain = await ctx.storageDomain.open(workbenchDomain)
  ctx.effect(function* () {
    // Keep storage available until runtime calls and provider scopes have stopped.
    yield () => domain.close()
    const runtime = new WorkbenchRuntime(ctx, domain, config)
    new WorkbenchPlatformAccess(ctx, runtime, config.platformTimeoutMs)
    if (config.exampleWorkbench) yield runtime.register(checklistProvider)
  })
}
