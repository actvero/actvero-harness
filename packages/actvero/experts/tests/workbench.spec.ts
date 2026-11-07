/** Workbench bundles reuse the native scoped Skill and MCP registries. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import Skills from '@deepseek-ai/dsh-skill'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { WorkbenchExpertBundle } from '../src/workbench.ts'
import type { WorkbenchRuntimeContext } from '@actvero/dsh-capability-ui'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workbench-expert-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Skills)
  const a = await loop.create(SessionId('bundle-a'))
  const b = await loop.create(SessionId('bundle-b'))
  const scopes = [createScope(ctx, a), createScope(ctx, b)]
  const bundle = join(root, 'bundle')
  const data = join(root, 'business')
  await mkdir(bundle)
  await mkdir(data)
  const manifest = { schemaVersion: 1, id: 'delivery', name: '交付助手', version: '1.0.0', description: '管理交付数据', instructions: 'Use the declared business tools.',
    skills: [{ key: 'delivery', label: '交付技能', required: true, load: 'always' }], connectors: [] }
  const save = () => writeFile(join(bundle, 'expert.json'), JSON.stringify(manifest))
  await save()
  await mkdir(join(bundle, 'skills', 'delivery'), { recursive: true })
  await writeFile(join(bundle, 'skills', 'delivery', 'SKILL.md'), '---\nname: delivery\ndescription: Manage delivery data\n---\nRead business files before changing them.\n')
  await writeFile(join(bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1, skills: [{ key: 'delivery', source: 'local', path: 'skills/delivery' }] }))
  const environment: WorkbenchRuntimeContext = { id: 'test:bundle' as WorkbenchRuntimeContext['id'], instanceId: 'instance' as WorkbenchRuntimeContext['instanceId'],
    version: '1.0.0', dataDirectory: data, resourcesDirectory: bundle, storage: 'custom', aiEnabled: true, sessionId: a.id }
  const prepare = () => ctx.waterfall(scopeTarget(a, a), 'agent/pre-step', { agent: a, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter' as const, messages: [] }))
  return { root, ctx, a, b, scopes, bundle, data, manifest, save, environment, prepare }
}

it('caches packaged skills by version, preserves native invocation policy and withdraws the scope', async () => {
  const f = await fixture()
  const helper = new WorkbenchExpertBundle({ directory: f.bundle })
  const first = await helper.activate(f.scopes[0]!.ctx, f.environment, new AbortController().signal)
  expect(first.expert?.instructions.replaceAll(f.data, '<data>').replaceAll(f.bundle, '<bundle>')).toMatchSnapshot()
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/u)
  expect((await f.ctx.skills.get('delivery', { scope: f.a }))?.resourceBase).toEqual({ kind: 'directory', path: join(f.bundle, 'skills/delivery') })
  expect(await f.ctx.skills.get('delivery', { scope: f.b })).toBeUndefined()
  expect(await f.ctx.skills.get('delivery')).toBeUndefined()
  await rm(join(f.bundle, 'expert.json'))
  const cached = await helper.activate(f.scopes[1]!.ctx, { ...f.environment, sessionId: f.b.id }, new AbortController().signal)
  expect(cached).toEqual(first)
  await expect(helper.activate(f.scopes[1]!.ctx, { ...f.environment, version: '2.0.0', sessionId: f.b.id }, new AbortController().signal)).rejects.toMatchObject({ code: 'bundle-invalid' })
  await f.scopes[0]!.dispose()
  expect(await f.ctx.skills.get('delivery', { scope: f.a })).toBeUndefined()
  expect(await f.ctx.skills.get('delivery', { scope: f.b })).toBeDefined()
})

it('loads skills on demand and rejects missing or changed installed dependencies', async () => {
  const f = await fixture()
  f.manifest.skills[0]!.load = 'on_demand'
  await f.save()
  const helper = new WorkbenchExpertBundle({ directory: f.bundle })
  const first = await helper.activate(f.scopes[0]!.ctx, f.environment, new AbortController().signal)
  expect(first.expert?.instructions).not.toContain('Read business files')
  await f.scopes[0]!.dispose()
  const installed = { name: 'approved', description: 'Approved skill', content: 'Approved instructions', source: 'bundled' }
  const remove = f.ctx.skills.register(installed)
  const sha256 = createHash('sha256').update(installed.content).digest('hex')
  await writeFile(join(f.bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1,
    skills: [{ key: 'delivery', source: 'installed', name: 'approved', sha256 }] }))
  const installedHelper = new WorkbenchExpertBundle({ directory: f.bundle })
  await installedHelper.activate(f.scopes[1]!.ctx, { ...f.environment, sessionId: f.b.id }, new AbortController().signal)
  remove()
  await expect(f.ctx.waterfall(scopeTarget(f.b, f.b), 'agent/pre-step', { agent: f.b, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter' as const, messages: [] }))).rejects.toMatchObject({ code: 'dependency-missing' })
  f.ctx.skills.register({ ...installed, content: 'Changed instructions' })
  await expect(new WorkbenchExpertBundle({ directory: f.bundle }).activate(f.scopes[1]!.ctx, f.environment, new AbortController().signal)).rejects.toMatchObject({ code: 'dependency-changed' })
})

it('mounts real stdio MCP per conversation and closes its process and tools on disposal', async () => {
  const f = await fixture()
  const server = join(f.bundle, 'server.mjs')
  await writeFile(server, `import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
 const request = JSON.parse(line); if (!('id' in request)) return;
 let result = {};
 if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'delivery', version: '1.0.0' } };
 if (request.method === 'tools/list') result = { tools: [{ name: 'save', description: 'Save delivery data', inputSchema: { type: 'object' } }] };
 if (request.method === 'tools/call') { writeFileSync(process.env.BUSINESS_FILE, 'MCP saved'); result = { content: [{ type: 'text', text: 'Saved' }] }; }
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
lines.on('close', () => { writeFileSync(process.env.CLOSED_FILE, 'closed'); process.exit(0); });
`)
  const closed = join(f.root, 'closed')
  const closedSecond = join(f.root, 'closed-second')
  await writeFile(join(f.bundle, 'mcp.json'), JSON.stringify({ transport: 'stdio', command: '${node}', args: ['${bundle}/server.mjs'], env: { BUSINESS_FILE: '${data}/delivery.txt', CLOSED_FILE: closed }, reconnect: { enabled: false } }))
  await writeFile(join(f.bundle, 'mcp-second.json'), JSON.stringify({ transport: 'stdio', command: '${node}', args: ['${bundle}/server.mjs'], env: { BUSINESS_FILE: '${data}/delivery.txt', CLOSED_FILE: closedSecond }, reconnect: { enabled: false } }))
  await writeFile(join(f.bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1, skills: [{ key: 'delivery', source: 'local', path: 'skills/delivery' }], connectors: [{ key: 'files', source: 'local', path: 'mcp.json' }, { key: 'second', source: 'local', path: 'mcp-second.json' }], cli: [{ name: 'delivery-cli', path: 'server.mjs', runtime: 'node', description: 'Run the delivery command' }] }))
  const manifest = { ...f.manifest, connectors: [{ key: 'files', label: '文件服务', required: true }, { key: 'second', label: '第二服务', required: true }] }
  await writeFile(join(f.bundle, 'expert.json'), JSON.stringify(manifest))
  const helper = new WorkbenchExpertBundle({ directory: f.bundle, runtimes: { node: process.execPath } })
  const activation = await helper.activate(f.scopes[0]!.ctx, f.environment, new AbortController().signal)
  expect(activation.expert?.instructions).toContain(`Command argv: ${JSON.stringify([process.execPath, server])}`)
  const names = f.ctx.tools.schemas(f.a).map(tool => tool.name).filter(name => name.startsWith('mcp__wb_'))
  expect(names).toHaveLength(2)
  expect(f.ctx.tools.get(names[0]!, f.b)).toBeUndefined()
  expect(f.ctx.tools.get(names[0]!)).toBeUndefined()
  await f.prepare()
  const result = await f.ctx.tools.execute({ agent: f.a, name: names[0]!, arguments: {}, callId: ToolCallId('save'), signal: new AbortController().signal })
  expect(result.isError).toBe(false)
  expect(await readFile(join(f.data, 'delivery.txt'), 'utf8')).toBe('MCP saved')
  await f.scopes[0]!.dispose()
  expect(f.ctx.tools.get(names[0]!, f.a)).toBeUndefined()
  expect(await readFile(closed, 'utf8')).toBe('closed')
  expect(await readFile(closedSecond, 'utf8')).toBe('closed')
  expect(f.ctx.tools.schemas(f.a).some(tool => tool.name.startsWith('mcp__wb_'))).toBe(false)
})

it('refuses corrupt bundles and already-cancelled activation without mounting capabilities', async () => {
  const f = await fixture()
  await writeFile(join(f.bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1, skills: [{ key: 'delivery', source: 'local', path: '../' }] }))
  const helper = new WorkbenchExpertBundle({ directory: f.bundle })
  await expect(helper.activate(f.scopes[0]!.ctx, f.environment, new AbortController().signal)).rejects.toMatchObject({ code: 'bundle-invalid' })
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  await expect(helper.activate(f.scopes[1]!.ctx, f.environment, abort.signal)).rejects.toThrow('cancelled')
  expect(await f.ctx.skills.list({ scope: f.a })).toEqual([])
})

it.each([true, false])('reports MCP startup failure and releases the caller scope (required: %s)', async (required) => {
  const f = await fixture()
  await writeFile(join(f.bundle, 'expert.json'), JSON.stringify({ ...f.manifest,
    connectors: [{ key: 'broken', label: 'Unavailable service', required }] }))
  await writeFile(join(f.bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1,
    skills: [{ key: 'delivery', source: 'local', path: 'skills/delivery' }],
    connectors: [{ key: 'broken', source: 'local', path: 'mcp.json' }] }))
  await writeFile(join(f.bundle, 'mcp.json'), JSON.stringify({ transport: 'stdio', command: '${node}',
    args: ['-e', 'process.exit(2)'], reconnect: { enabled: false } }))
  const helper = new WorkbenchExpertBundle({ directory: f.bundle, runtimes: { node: process.execPath } })
  const activation = helper.activate(f.scopes[0]!.ctx, f.environment, new AbortController().signal)
  if (required) await expect(activation).rejects.toMatchObject({ code: 'dependency-unavailable' })
  else expect((await activation).expert?.instructions).toContain('Optional MCP unavailable: Unavailable service')
  await f.scopes[0]!.dispose()
  expect(f.ctx.tools.schemas(f.a).some(tool => tool.name.startsWith('mcp__wb_'))).toBe(false)
  expect(await f.ctx.skills.get('delivery', { scope: f.a })).toBeUndefined()
})
