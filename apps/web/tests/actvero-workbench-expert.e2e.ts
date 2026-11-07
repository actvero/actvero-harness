/** Bundled experts execute through the shipped Desktop Host, native loop and native shell. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { DesktopHostProcess } from '../../desktop/src/host-process.ts'
import { DesktopProjectManager } from '../../desktop/src/project-manager.ts'
import { resolveDesktopPaths } from '../../desktop/src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../desktop/src/host-protocol.ts'
import { prepareDevelopmentProject } from '../../desktop/scripts/development-project.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const version = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
const entry = (path: string) => JSON.stringify(pathToFileURL(join(repository, path)).href)

// This composition exercises bash; Windows needs the corresponding native pwsh fixture.
it.skipIf(process.platform === 'win32' || !existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('loads a versioned expert and uses direct tools, Skill/CLI and MCP against one author-owned file', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'actvero-workbench-expert-')))
  let host: DesktopHostProcess | undefined
  try {
    const home = join(root, 'home')
    const bundle = join(root, 'bundle')
    const report = join(root, 'report.json')
    mkdirSync(home)
    mkdirSync(join(bundle, 'skills', 'delivery'), { recursive: true })
    writeFileSync(join(bundle, 'expert.json'), JSON.stringify({ schemaVersion: 1, id: 'delivery', name: '交付助手', version: '1.0.0', description: 'Manage deliveries',
      instructions: 'Use the declared tools to update delivery.txt. Report only successful changes.',
      skills: [{ key: 'delivery', label: '交付技能', required: true, load: 'always' }], connectors: [{ key: 'files', label: '文件服务', required: true }] }))
    writeFileSync(join(bundle, 'skills/delivery/SKILL.md'), '---\nname: delivery\ndescription: Update delivery files\n---\nUse the bundled delivery CLI for the second update.\n')
    writeFileSync(join(bundle, 'cli.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], '|cli');\n")
    writeFileSync(join(bundle, 'server.mjs'), `import { createInterface } from 'node:readline'; import { appendFileSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => { const r = JSON.parse(line); if (!('id' in r)) return; let result = {};
 if (r.method === 'initialize') result = { protocolVersion: r.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'delivery', version: '1.0.0' } };
 if (r.method === 'tools/list') result = { tools: [{ name: 'save', description: 'Save delivery data', inputSchema: { type: 'object' } }] };
 if (r.method === 'tools/call') { appendFileSync(process.env.BUSINESS_FILE, '|mcp'); result = { content: [{ type: 'text', text: 'Saved' }] }; }
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\\n'); });
lines.on('close', () => process.exit(0));\n`)
    writeFileSync(join(bundle, 'mcp.json'), JSON.stringify({ transport: 'stdio', command: '${node}', args: ['${bundle}/server.mjs'], env: { BUSINESS_FILE: '${data}/delivery.txt' }, reconnect: { enabled: false } }))
    writeFileSync(join(bundle, 'dependencies.json'), JSON.stringify({ schemaVersion: 1, skills: [{ key: 'delivery', source: 'local', path: 'skills/delivery' }],
      connectors: [{ key: 'files', source: 'local', path: 'mcp.json' }], cli: [{ name: 'delivery', path: 'cli.mjs', runtime: 'node', description: 'Append CLI update to the file argument.' }] }))
    cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), { recursive: true })
    const fixture = join(root, 'fixture.mjs')
    writeFileSync(fixture, `
import { WorkbenchExpertBundle } from ${entry('packages/actvero/experts/lib/workbench.js')};
import { LlmAdapter, createUserMessage } from ${entry('packages/llm/llm/lib/index.js')};
import { defineTool } from ${entry('packages/core/tools/lib/index.js')};
import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path';
export const inject = ['appReady', 'actveroWorkbenchRuntime', 'llm', 'agents', 'tools', 'skills'];
export function apply(ctx) {
 const stop = ctx.appReady.onReady(() => { void exercise(ctx).catch(error => writeFile(${JSON.stringify(report)}, JSON.stringify({ error: String(error), stack: error.stack }))); });
 ctx.effect(() => stop);
}
async function exercise(ctx) {
 const runtime = ctx.actveroWorkbenchRuntime;
 const helper = new WorkbenchExpertBundle({ directory: ${JSON.stringify(bundle)}, runtimes: { node: process.execPath } });
 const requests = [];
 class Adapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
   if (!options.tools?.some(tool => tool.name === 'delivery_direct')) { yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Delivery verification' } }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
   requests.push(options); const i = requests.length;
   if (i === 4) { yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Completed' } }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
   const name = i === 1 ? 'delivery_direct' : i === 2 ? 'bash' : options.tools.find(t => t.name.startsWith('mcp__wb_')).name;
   const args = i === 2 ? { description: 'Update delivery using bundled CLI', command: ${JSON.stringify([process.execPath, join(bundle, 'cli.mjs')])}.concat([join(data, 'delivery.txt')]).map(v => "'" + v.replaceAll("'", "'\\\\''") + "'").join(' ') } : {};
   const json = JSON.stringify(args); const id = 'delivery-' + i;
   yield { type: 'block-start', index: 0, blockType: 'tool-call' }; yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json };
   yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } }; yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
 }
 ctx.effect(() => ctx.llm.registerAdapter(['bundle-fixture'], new Adapter()));
 ctx.effect(() => runtime.register({ id: 'test:bundle-smoke', name: '交付验证', version: '1.0.0', ai: true, resourcesDirectory: ${JSON.stringify(bundle)},
  activate: async (scope, environment, signal) => {
   const activation = await helper.activate(scope, environment, signal);
   scope.get('tools').register(defineTool({ name: 'delivery_direct', description: 'Write delivery data.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { await writeFile(join(environment.dataDirectory, 'delivery.txt'), 'direct'); return 'Saved'; } }));
   return activation;
  } }));
 const instance = await runtime.open('test:bundle-smoke'); const { dataDirectory: data } = await runtime.environment(instance);
 const binding = await runtime.bind(instance);
  const agent = ctx.agents.get(binding.sessionId);
  const idle = new Promise((resolve, reject) => { const a = ctx.on('agent/status', event => { if (event.agent === agent && event.status === 'idle') { a(); b(); resolve(); } }); const b = ctx.on('agent/error', event => { if (event.agent === agent) { a(); b(); reject(event.error); } }); });
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Update the delivery using each declared method.' }], source: { kind: 'user' } })); await idle;
  const events = agent.session.snapshotEvents(); const modelText = JSON.stringify(requests[0]?.messages);
  const names = requests[0]?.tools?.map(tool => tool.name) ?? [];
  const file = await readFile(join(data, 'delivery.txt'), 'utf8');
  await runtime.detach({ sessionId: agent.id });
  const developerSkill = await ctx.skills.get('develop-workbench');
  await writeFile(${JSON.stringify(report)}, JSON.stringify({ file, requests: requests.length,
   developerSkill: developerSkill?.content.includes('reference/guide.zh.md') && developerSkill.source === 'bundled',
   developerGuide: developerSkill?.resourceBase?.kind === 'directory'
     && await readFile(join(developerSkill.resourceBase.path, 'reference/guide.zh.md'), 'utf8') === ${JSON.stringify(readFileSync(join(repository, 'actvero/workbench-development.zh.md'), 'utf8'))},
   skillInPrompt: modelText.includes('Use the bundled delivery CLI'), cliInPrompt: modelText.includes('Command argv:'),
   directVisible: names.includes('delivery_direct'), mcpVisible: names.some(name => name.startsWith('mcp__wb_')),
   leaked: !!ctx.tools.get('delivery_direct') || !!await ctx.skills.get('delivery'),
   released: !ctx.tools.get('delivery_direct', agent) && !await ctx.skills.get('delivery', { scope: agent }),
   digestRecorded: events.some(event => event.type === 'actvero/workbench' && event.data.selection?.capabilityDigest === binding.selection.capabilityDigest),
   toolResults: events.filter(event => event.type === 'tool/result').length,
   diagnostics: { names, events: events.filter(event => event.type.startsWith('tool/')) } }));
}

`)
    const pnpmDirectory = join(repository, 'apps/desktop/node_modules/pnpm')
    const project = prepareDevelopmentProject({ projectDir: join(root, 'project'), cliDir: join(repository, 'apps/cli'), hostDir: join(repository, 'apps/desktop-host'),
      dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'), target: 'mac-arm64',
      release: { schemaVersion: 1, version: version(join(repository, 'apps/desktop/package.json')), pnpmVersion: version(join(pnpmDirectory, 'package.json')),
        nodeVersion: process.versions.node, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION } })
    const paths = resolveDesktopPaths(home)
    await new DesktopProjectManager(paths, { dsh: project }).applyRelease()
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), [
      '- id: webserver', '  config:', '    host: 127.0.0.1', '    port: 0',
      '- id: web-runtime', '  config:', '    printUrl: false', '    openBrowser: false',
      '- id: agent-default-model', '  config:', '    provider: bundle-fixture', '    model: fixture',
      '- insert:', '    - id: bundle-fixture', `      name: ${JSON.stringify(pathToFileURL(fixture).href)}`, '',
    ].join('\n'))
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD/u.test(name)))
    host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, { ...environment, DSH_HOME: home, ACTVERO_DESKTOP: '1', DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_MODE: 'DISABLED' },
      undefined, undefined, { pnpm: join(pnpmDirectory, 'bin/pnpm.cjs'), nodeBin: dirname(process.execPath) }, undefined, (message) => {
        if (message.type === 'actvero:mcp:request' || message.type === 'actvero:skills:request') {
          host?.sendCapabilityMessage({ type: message.type === 'actvero:mcp:request' ? 'actvero:mcp:result' : 'actvero:skills:result', id: message.id, value: [] })
        } else if (message.type === 'actvero:experts:request') host?.sendCapabilityMessage({ type: 'actvero:experts:result', id: message.id, error: 'expert_not_found' })
      })
    await host.start()
    await expect.poll(() => existsSync(report), { timeout: 25_000 }).toBe(true)
    const result = JSON.parse(readFileSync(report, 'utf8')) as Record<string, unknown>
    if (result.file !== 'direct|cli|mcp') throw new Error(JSON.stringify(result))
    delete result.diagnostics
    expect(result).toEqual({ file: 'direct|cli|mcp', requests: 4, skillInPrompt: true, cliInPrompt: true,
      developerSkill: true, developerGuide: true, directVisible: true, mcpVisible: true,
      leaked: false, released: true, digestRecorded: true, toolResults: 3 })
  } finally { await host?.stop(); rmSync(root, { recursive: true, force: true }) }
})
