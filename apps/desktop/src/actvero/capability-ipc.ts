/** Closed Main ↔ Host protocol. Credentials and arbitrary channel names are excluded. */
export type CapabilityHostMessage =
 | { type:'actvero:workbench:request';id:string;action:'models';input:Record<string,never> }
 | { type:'actvero:workbench:cancel';id:string }
 | { type:'actvero:skills:request';id:string;action:'list'|'get';input:Record<string,unknown> }
 | { type:'actvero:skills:synced';id:string;value?:unknown;error?:string }
 | { type:'actvero:experts:controlled';id:string;value?:unknown;error?:string }
 | { type:'actvero:experts:request';id:string;action:'prepare'|'resolve'|'activate'|'catalog'|'create'|'record-use'|'connector-state';input:Record<string,unknown> }
 | { type:'actvero:mcp:request';id:string;action:'snapshot'|'call';input:Record<string,unknown> }
 | { type:'actvero:mcp:cancel';id:string }
 | { type:'actvero:llm:request';id:string;action:'resource-token';input:{ resource:string } }
export type CapabilityMainMessage =
 | { type:'actvero:skills:result'|'actvero:experts:result'|'actvero:mcp:result'|'actvero:llm:result'|'actvero:workbench:result';id:string;value?:unknown;error?:string }
 | { type:'actvero:skills:sync';id:string;name?:string;skillId?:string }
 | { type:'actvero:experts:control';id:string;action:'select'|'selection'|'connector-state'|'connector-select';input:Record<string,unknown> }
 | { type:'actvero:skills:changed'|'actvero:mcp:changed'|'actvero:llm:changed' }
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)}
function bounded(v:unknown):v is Record<string,unknown>{
  if(!record(v))return false
  try{return JSON.stringify(v).length<=1024*1024}catch(_error){return false}
}
/** Unknown types, oversized messages, extra fields and unsupported actions remain fatal. */
export function isCapabilityHostMessage(value:unknown):value is CapabilityHostMessage {
  if(!bounded(value)||!id(value.id))return false
  const type=value.type
  const cancellation=type==='actvero:mcp:cancel'||type==='actvero:workbench:cancel'
  const fields=cancellation?['type','id']:['type','id','action','input']
  if(type==='actvero:skills:synced'||type==='actvero:experts:controlled'){
    if(Object.keys(value).some(k=>!['type','id','value','error'].includes(k)))return false
    return value.error===undefined||typeof value.error==='string'&&/^[a-z_]{1,80}$/.test(value.error)
  }
  if(Object.keys(value).some(k=>!fields.includes(k)))return false
  if(type==='actvero:mcp:cancel'||type==='actvero:workbench:cancel')return true
  if(type==='actvero:workbench:request'){
    return value.action==='models'&&record(value.input)&&Object.keys(value.input).length===0
  }
  const actions:Record<string,string[]>={ 'actvero:skills:request':['list','get'],'actvero:experts:request':['prepare','resolve','activate','catalog','create','record-use','connector-state'],'actvero:mcp:request':['snapshot','call'],'actvero:llm:request':['resource-token'] }
  if(type==='actvero:llm:request'){
    const requestInput=value.input
    return record(requestInput)&&typeof requestInput.resource==='string'
      && /^(?:llm:catalog|llm:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(requestInput.resource)
  }
  return typeof type==='string'&&!!actions[type]?.includes(String(value.action))&&record(value.input)
}
