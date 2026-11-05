/** Native Agent instructions and tools are resolved from the persisted business association. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { actionSchema, WorkbenchError } from './contracts.ts'
import type { WorkbenchRuntime } from './runtime.ts'

/**
 * Register session-scoped business instructions and data tools through native Agent extension points.
 * @param ctx - Cordis effect owner with native tools, prompts and Agents.
 * @param runtime - Durable workbench provider registry and local records.
 */
export function registerAgentContext(ctx: Context, runtime: WorkbenchRuntime): void {
  const projectFor = async (sessionId: Parameters<typeof runtime.projectForSession>[0]) => {
    const project = await runtime.projectForSession(sessionId)
    if (!project || !runtime.providers.has(project.workbenchId)) throw new WorkbenchError('unavailable')
    return project
  }
  ctx.tools.register(defineTool({ name: 'actvero_workbench_read', presentCall: () => ({ card: 'generic', title: 'Read workbench', kind: 'other' }), description: 'Read the latest data and revision of the business workbench associated with this conversation. The displayed business page and this tool use the same local data.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async (_args, exec) => {
    if (!exec.agent) throw new WorkbenchError('unavailable')
    return JSON.stringify(await projectFor(exec.agent.id))
  } }))
  ctx.tools.register(defineTool({ name: 'actvero_workbench_update', presentCall: () => ({ card: 'generic', title: 'Update workbench', kind: 'other' }), description: 'Save the complete JSON data of the current business workbench. Read it first and supply that revision. Changes appear in the business interface. This changes local records, not generated media or published content.', parameters: { revision: { type: 'integer', required: true, description: 'Revision returned by actvero_workbench_read.' }, dataJson: { type: 'string', required: true, description: 'The complete updated project data as a JSON object.' } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async (args, exec) => {
    if (!exec.agent) throw new WorkbenchError('unavailable')
    const project = await projectFor(exec.agent.id)
    const data: unknown = JSON.parse(args.dataJson)
    const action = actionSchema.parse({ action: 'update', projectId: project.id, revision: args.revision, data })
    await runtime.action(action)
    return JSON.stringify(await projectFor(exec.agent.id))
  } }))
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const agent = ctx.agents.list().find(item => item === context.scope)
    const project = agent && await runtime.projectForSession(agent.id)
    const provider = project && runtime.providers.get(project.workbenchId)
    if (!project || !provider) return { ...assembly, tools: assembly.tools.filter(tool => !tool.name.startsWith('actvero_workbench_')) }
    return { ...assembly, sections: [...assembly.sections, { name: 'actvero-workbench', text: '{{actvero_workbench}}' }], variables: { ...assembly.variables, actvero_workbench: 'Workbench: ' + provider.descriptor.title + '\nProject: ' + project.title + '\n' + provider.instructions } }
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name.startsWith('actvero_workbench_') && (!exec.agent || !await runtime.projectForSession(exec.agent.id))) return { kind: 'deny', reason: 'workbench_context_required' }
    return next()
  })
}
