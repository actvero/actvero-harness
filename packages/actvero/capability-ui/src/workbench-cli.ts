/** Locate the CLI installed with this Desktop without exposing its private development connection. */
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { WorkbenchCliInvocation } from './types.ts'

/** Read the process invocation selected by the Desktop Main process.
 * @returns The installed executable, fixed arguments and Node-mode environment, or null in an unbundled Host.
 */
export function installedWorkbenchCli(): WorkbenchCliInvocation | null {
  const entry = process.env.ACTVERO_WORKBENCH_CLI_ENTRY
  if (!entry || !isAbsolute(entry) || !existsSync(entry)) return null
  return { executable: process.execPath, args: ['--expose-internals', entry], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

/** Advertise the installed CLI to authoring sessions.
 * @param ctx Scope owning the native discovery tool.
 */
export function registerWorkbenchCliDiscovery(ctx: Context): void {
  if (!installedWorkbenchCli()) return
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'workbench_cli_info',
    description: 'Find the workbench CLI installed with this Harness. Use its executable, args and per-process env with the shell tool. '
      + 'Append schema list or a workbench command to args. Use native tools for local Skill, MCP and expert management in this session.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => JSON.stringify(installedWorkbenchCli()),
    presentCall: args => ({ card: 'generic', title: 'Discover the installed workbench CLI', kind: 'other', rawInput: args }),
  })))
}
