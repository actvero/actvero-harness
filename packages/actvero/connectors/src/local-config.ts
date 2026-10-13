export type TransportKind = 'http' | 'sse' | 'stdio'
export type AuthKind = 'none' | 'bearer' | 'headers' | 'oauth'
export interface CustomConfig {
  name:string; transport:TransportKind; url:string; command:string; args:string[]; cwd:string
  env:Record<string,string>; auth:AuthKind; token:string; headers:Record<string,string>; clientId:string
}
export interface CustomView extends Omit<CustomConfig,'token'|'env'|'headers'> {
  id:string; enabled:boolean; status:'connecting'|'connected'|'error'|'authorization_required'|'disabled'
  error?:string; token:string; hasToken:boolean; env:Record<string,string>; headers:Record<string,string>
  hasAuthorization:boolean
}
export class LocalConnectorError extends Error { constructor(readonly code:string){super(code)} }
export const bad=(code='invalid_configuration'):never=>{throw new LocalConnectorError(code)}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
function text(v:unknown,max=2048){if(v===undefined)return '';if(typeof v!=='string'||v.length>max||v.includes('\0'))return bad();return v}
function dictionary(v:unknown,headers=false){
  if(v===undefined)return {};if(!object(v)||Object.keys(v).length>100)return bad()
  const output:Record<string,string>={};const seen=new Set<string>()
  for(const [k,val] of Object.entries(v)){
    if(!(headers?/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/:/^[A-Za-z_][A-Za-z0-9_]*$/).test(k)||k.length>100)return bad()
    const key=headers?k.toLowerCase():k
    if(seen.has(key)||['__proto__','constructor','prototype'].includes(k))return bad();seen.add(key)
    if(headers&&['host','content-length','connection','cookie','origin','mcp-session-id','mcp-protocol-version'].includes(key))return bad('reserved_header')
    const value=text(val,8192);if(headers&&/[\r\n]/.test(value))return bad();output[k]=value
  }return output
}
export function normalizeConfig(value:unknown):CustomConfig {
  if(!object(value))return bad()
  const name=text(value.name,80).trim();if(!name)return bad('name_required')
  const transport=value.transport??value.type??(value.command?'stdio':'http')
  if(!['http','sse','stdio'].includes(String(transport)))return bad('unsupported_transport')
  const auth=value.auth??(value.token?'bearer':value.headers?'headers':'none')
  if(!['none','bearer','headers','oauth'].includes(String(auth)))return bad('unsupported_auth')
  const result:CustomConfig={ name,transport:transport as TransportKind,auth:auth as AuthKind,url:text(value.url),command:text(value.command),args:[],cwd:text(value.cwd),env:dictionary(value.env),token:text(value.token,8192),headers:dictionary(value.headers,true),clientId:text(value.clientId) }
  if(value.args!==undefined){if(!Array.isArray(value.args)||value.args.length>100)return bad();result.args=value.args.map(v=>text(v,8192))}
  if(transport==='stdio'){
    if(!result.command.trim())return bad('command_required')
    result.url='';result.auth='none';result.token='';result.headers={};result.clientId=''
  }else{
    let url:URL;try{url=new URL(result.url)}catch{return bad('url_required')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)return bad('invalid_url')
    result.url=url.href;result.command='';result.args=[];result.cwd='';result.env={}
    if(result.auth!=='bearer')result.token='';if(result.auth!=='headers')result.headers={};if(result.auth!=='oauth')result.clientId=''
  }
  return result
}
export function parseConfigurations(raw:string):CustomConfig[]{
  if(typeof raw!=='string'||raw.length>100_000)return bad('configuration_too_large')
  let value:unknown;try{value=JSON.parse(raw)}catch(e){const match=/position (\d+)/.exec(String(e));const line=match?raw.slice(0,Number(match[1])).split('\n').length:1;return bad(`json_syntax_line_${line}`)}
  if(!object(value))return bad()
  const allowed=new Set(['name','type','transport','url','command','args','env','headers','auth','token','cwd','clientId'])
  const parse=(v:unknown,name?:string)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.has(k)))return bad('unsupported_config_fields');return normalizeConfig({ ...v,name:name??v.name })}
  let rows:CustomConfig[]
  if('mcpServers' in value){if(Object.keys(value).length!==1||!object(value.mcpServers))return bad();rows=Object.entries(value.mcpServers).map(([name,v])=>parse(v,name))}
  else rows=[parse(value)]
  if(!rows.length||rows.length>20)return bad('configuration_count')
  const names=rows.map(r=>r.name.toLocaleLowerCase());if(new Set(names).size!==names.length)return bad('name_conflict');return rows
}
