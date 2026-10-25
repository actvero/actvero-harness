/** Built official Host composition, with no business credentials or modified installations. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Experts, ExpertSelections } from '@actvero/dsh-experts/main'
import type { ExpertSelection } from '@actvero/dsh-experts/contracts'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { prepareDevelopmentProject } from '../scripts/development-project.ts'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
function version(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
}
describe.skipIf(!existsSync(join(repository, 'apps/desktop-host/lib/index.js')))('built ACTVERO capability composition', () => {
  it('loads all four capability clients and keeps the ordinary official product isolated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'actvero-account-composition-'))
    let host: DesktopHostProcess | undefined
    try {
      for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(name)) vi.stubEnv(name, undefined)
      const home = join(root, 'home')
      mkdirSync(home)
      vi.stubEnv('DSH_HOME', home)
      vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
      const project = prepareDevelopmentProject({
        projectDir: join(root, 'project'),
        cliDir: join(repository, 'apps/cli'),
        hostDir: join(repository, 'apps/desktop-host'),
        dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
        release: {
          schemaVersion: 1,
          version: version(join(repository, 'apps/desktop/package.json')),
          pnpmVersion: version(join(repository, 'apps/desktop/node_modules/pnpm/package.json')),
          nodeVersion: process.versions.node,
          hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        },
        target: 'mac-x64',
      })
      cpSync(join(repository, 'packages/skill/skill-office/assets'), join(root, 'runtime/office-skills'), {
        recursive: true,
      })
      const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
      mkdirSync(nodeBin, { recursive: true })
      cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'))
      const paths = resolveDesktopPaths(home),
        manager = new DesktopProjectManager(paths, { dsh: project })
      await manager.applyRelease()
      writeFileSync(
        join(paths.profile, 'cordis.patch.yml'),
        '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- id: web-runtime\n  config:\n    printUrl: false\n    openBrowser: false\n',
      )
      const experts=new Experts({ root:join(root,'experts'),scope:()=> 'local',changed:()=>{},
        skills:{ hostList:async()=>[],hostGet:async()=>undefined },connectors:async()=>[] })
      await experts.save({ manifest:{ schemaVersion:1,id:'local-composition',version:'1.0.0',name:'Composition expert',description:'Isolated selection',avatar:'',tags:[],instructions:'Read the supplied documents.',conversationStarters:[],skills:[],connectors:[] },bindings:{ skills:{},connectors:{} },revision:0 })
      const selections=new ExpertSelections({ scope:()=> 'local',revision:()=>0,prepare:id=>experts.prepareRuntime(id) })
      const prepare=vi.spyOn(experts,'prepareRuntime'),resolve=vi.spyOn(experts,'resolve')
      const controls=new Map<string,{ resolve(value:unknown):void;reject(error:Error):void }>()
      const control=(action:'select'|'selection',input:Record<string,unknown>)=>new Promise<unknown>((done,reject)=>{
        const id=randomUUID(),timer=setTimeout(()=>{controls.delete(id);reject(new Error('control timeout'))},10000)
        controls.set(id,{ resolve:(value)=>{clearTimeout(timer);done(value)},reject:(error)=>{clearTimeout(timer);reject(error)} })
        host!.sendCapabilityMessage({ type:'actvero:experts:control',id,action,input })
      })
      let stopping=false
      const createHost=()=>new DesktopHostProcess(process.execPath, project, paths.profile,undefined,process.env,
        undefined,undefined,undefined,undefined,onCapability)
      const onCapability:NonNullable<ConstructorParameters<typeof DesktopHostProcess>[9]>=(message)=>{
        if(stopping)return

        if(message.type==='actvero:mcp:request'||message.type==='actvero:skills:request')host?.sendCapabilityMessage({ type:message.type==='actvero:mcp:request'?'actvero:mcp:result':'actvero:skills:result',id:message.id,value:[] })
        else if(message.type==='actvero:experts:controlled'){
          const pending=controls.get(message.id);controls.delete(message.id)
          if(message.error)pending?.reject(new Error(message.error));else pending?.resolve(message.value)
        }else if(message.type==='actvero:experts:request'){
          const { input,action }=message
          const work=async()=>{
            if(action==='prepare')return (await selections.prepare(String(input.operation),String(input.id))).lock
            if(action==='activate'){await selections.resolve(String(input.operation),String(input.id));return { added:[],enabled:[],ready:[],rows:[] }}
            if(action==='resolve')return typeof input.operation==='string'?selections.resolve(input.operation,String(input.id)):experts.resolve(String(input.id))
            if(action==='connector-state')return { added:[],enabled:[],ready:[],rows:[] }
            return experts.dispatch(action,input)
          }
          void work().then(value=>host?.sendCapabilityMessage({ type:'actvero:experts:result',id:message.id,value }),(error:unknown)=>host?.sendCapabilityMessage({ type:'actvero:experts:result',id:message.id,error:error instanceof Error?error.message:'expert_action_failed' }))
        }
      }
      for (const enabled of ['1', '0']) {
        vi.stubEnv('ACTVERO_DESKTOP', enabled)
        stopping=false;host=createHost()
        const ready = await host.start()
        const graph = ready.injections?.find(
          row => typeof row === 'object' && row !== null && 'name' in row && row.name === '__DSH_BOOT__',
        )
        const serialized = JSON.stringify(graph)
        expect(serialized).toBeDefined()
        if (enabled === '1') {
          expect(serialized).toContain('@actvero/dsh-client-account')
          for(const name of ['capability-ui','skills','connectors','experts'])expect(serialized).toContain('@actvero/dsh-'+name)
          expect(serialized).not.toContain('@deepseek-ai/dsh-client-ui-settings-account')
          expect(serialized).not.toContain('@deepseek-ai/dsh-client-ui-brand-official')
          const auth = await fetch(ready.url, { redirect: 'manual' })
          const cookie = auth.headers
            .getSetCookie()
            .map(value => value.split(';')[0])
            .join('; ')
          await auth.body?.cancel()
          if (
            !graph ||
            typeof graph !== 'object' ||
            !('value' in graph) ||
            !graph.value ||
            typeof graph.value !== 'object' ||
            !('batches' in graph.value) ||
            !Array.isArray(graph.value.batches)
          )
            throw new Error('Missing client batches')
          const batches: unknown[] = graph.value.batches
          const batch = batches.find(
            (row: unknown) =>
              typeof row === 'object' && row !== null && JSON.stringify(row).includes('@actvero/dsh-client-account'),
          )
          if (!batch || typeof batch !== 'object' || !('url' in batch) || typeof batch.url !== 'string')
            throw new Error('Missing account artifact')
          const response = await fetch(new URL(batch.url, ready.url), { headers: { cookie } })
          expect(response.status).toBe(200)
          const asset = await response.text()
          expect(asset).toContain('actvero.account')
          expect(asset).toContain('settings.section')
          expect(asset).toContain('sidebar.brand.mark')
          const workspacePath=join(root,'workspace');mkdirSync(workspacePath)
          const responseWorkspace=await fetch(new URL('/api/workspace/create',ready.url),{
            method:'POST',headers:{ 'content-type':'application/json',cookie },
            body:JSON.stringify({ type:'client-request',rpcId:randomUUID(),method:'workspace/create',payload:{ args:{ request:{ path:workspacePath } } } }),
          })
          const created=await responseWorkspace.json() as { result:{ ok:boolean;value:{ workspace:{ workspaceId:string } } } }
          expect(created.result.ok).toBe(true)
          const result=await selections.run('local-composition',operation=>control('select',{ id:'local-composition',workspaceId:created.result.value.workspace.workspaceId,operation })) as { sessionId:string;selection:ExpertSelection }
          expect(result.selection).toMatchObject({ id:'local-composition',name:'Composition expert',version:'1.0.0' })
          expect(prepare).toHaveBeenCalledTimes(1)
          expect(resolve).not.toHaveBeenCalled()
          expect(await control('selection',{ sessionId:result.sessionId })).toEqual(result.selection)
          // Reload the built Host from the persisted Session; operation evidence is gone.
          stopping=true;await host.stop();stopping=false;host=createHost();await host.start()
          expect(await control('selection',{ sessionId:result.sessionId })).toEqual(result.selection)

        } else {
          expect(serialized).not.toContain('@actvero/dsh-client-account')
          for(const name of ['capability-ui','skills','connectors','experts'])expect(serialized).not.toContain('@actvero/dsh-'+name)
          expect(serialized).toContain('@deepseek-ai/dsh-client-ui-settings-account')
          expect(serialized).toContain('@deepseek-ai/dsh-client-ui-brand-official')
        }
        stopping=true;await host.stop()
        host = undefined
      }
    } finally {
      await host?.stop()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  },60000)
})
