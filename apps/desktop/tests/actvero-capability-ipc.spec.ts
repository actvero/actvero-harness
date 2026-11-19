import { describe,it,expect } from 'vitest'
import { isCapabilityHostMessage } from '../src/actvero/capability-ipc.ts'
const id='11111111-1111-4111-8111-111111111111'
describe('closed capability Host protocol',()=>{
  it('admits expert authoring without exposing general save or remove actions', () => {
    for (const action of ['author-list', 'author-get', 'author-update', 'author-check']) {
      expect(isCapabilityHostMessage({ type: 'actvero:experts:request', id, action, input: {} })).toBe(true)
    }
    for (const action of ['save', 'remove', 'package-apply']) {
      expect(isCapabilityHostMessage({ type: 'actvero:experts:request', id, action, input: {} })).toBe(false)
    }
  })

  it('admits only declared workbench and local management commands', () => {
    expect(isCapabilityHostMessage({ type: 'actvero:workbench:request', id, action: 'models', input: {} })).toBe(true)
    expect(isCapabilityHostMessage({ type: 'actvero:workbench:cancel', id })).toBe(true)
    expect(isCapabilityHostMessage({ type: 'actvero:workbench:request', id, action: 'manage-local', input: { operation: 'skill-list' } })).toBe(true)
    for (const value of [
      { type: 'actvero:workbench:request', id, action: 'models', input: { url: 'https://other.example' } },
      { type: 'actvero:workbench:request', id, action: 'token', input: {} },
      { type: 'actvero:workbench:cancel', id, input: {} },
      { type: 'actvero:workbench:request', id, action: 'manage-local', input: { operation: 'mcp-remove' } },
      { type: 'actvero:workbench:request', id, action: 'manage-local', input: { operation: 'mcp-create', config: { name: 'Test', transport: 'http', token: 'private' } } },
    ]) expect(isCapabilityHostMessage(value)).toBe(false)
  })

  it('accepts fixed read/call messages and bounded correlated completions',()=>{for(const [type,action] of [['actvero:skills:request','list'],['actvero:skills:request','get'],['actvero:experts:request','activate'],['actvero:mcp:request','call']])expect(isCapabilityHostMessage({ type,id,action,input:{} })).toBe(true);expect(isCapabilityHostMessage({ type:'actvero:llm:request',id,action:'resource-token',input:{ resource:'llm:catalog' } })).toBe(true);expect(isCapabilityHostMessage({ type:'actvero:llm:request',id,action:'resource-token',input:{ resource:'llm:11111111-1111-4111-8111-111111111111' } })).toBe(true);expect(isCapabilityHostMessage({ type:'actvero:mcp:cancel',id })).toBe(true);expect(isCapabilityHostMessage({ type:'actvero:experts:controlled',id,value:{ sessionId:'s' } })).toBe(true)})
  it('rejects arbitrary IPC, actions, extra fields, malformed ids and oversized payloads',()=>{for(const value of [{ type:'extension.receive',id,action:'logout',input:{} },{ type:'actvero:mcp:request',id,action:'shell',input:{} },{ type:'actvero:llm:request',id,action:'resource-token',input:{ resource:'llm:not-a-uuid' } },{ type:'actvero:skills:request',id,action:'list',input:{},token:'secret' },{ type:'actvero:skills:request',id:'f'.repeat(36),action:'list',input:{} },{ type:'actvero:skills:request',id,action:'list',input:[] },{ type:'actvero:skills:request',id,action:'list',input:{ value:'x'.repeat(1024*1024) } },{ type:'actvero:experts:controlled',id,error:'https://secret.example' }])expect(isCapabilityHostMessage(value)).toBe(false)})
})
