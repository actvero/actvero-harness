import { createHash } from 'node:crypto'
import { parseManifest,validId,fail } from './schema.ts'
import type { ExpertManifest } from './contracts.ts'

export type { RemoteSummary,RemoteEnvelope,RemoteSnapshot,RemoteDependency,RemotePlan } from './remote-types.ts'
import type { RemoteSummary,RemoteEnvelope } from './remote-types.ts'
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex')
export function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}'
  if(typeof value==='string'||typeof value==='boolean'||value===null||Number.isSafeInteger(value))return JSON.stringify(value)
  return fail('expert_remote_invalid')
}
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const string=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!v.includes('\0')
export function summary(value:unknown):RemoteSummary {
  const v=value as RemoteSummary
  if(!v||![1,2,3].includes(v.contract_version))fail('expert_remote_unsupported')
  if(!uuid(v.expert_id)||!v.release||!uuid(v.release.id)||!sha(v.release.sha256)||!string(v.release.version,30)||!/^\d+\.\d+\.\d+$/.test(v.release.version)||!Number.isSafeInteger(v.metadata_revision)||v.metadata_revision<0||!v.category||!string(v.category.id,200)||!v.category.id||!string(v.category.name,200))fail('expert_remote_invalid')
  parseManifest({ schemaVersion:1,id:v.expert_id,version:v.release.version,name:v.name,description:v.description,avatar:v.avatar,tags:v.tags,instructions:'summary',skills:[],connectors:[] })
  return v
}
export function envelope(value:unknown):RemoteEnvelope {
  const v=summary(value) as RemoteEnvelope,m=parseManifest(v.manifest),refs=v.dependency_refs
  if(m.id!==v.expert_id||m.version!==v.release.version||!refs||Object.keys(refs).some(k=>!['skills','connectors'].includes(k))||!Array.isArray(refs.skills)||!Array.isArray(refs.connectors))fail('expert_remote_invalid')
  for(const kind of ['skills','connectors'] as const){
    const rows=refs[kind];if(rows.length!==m[kind].length||new Set(rows.map(r=>r.key)).size!==rows.length)fail('expert_remote_invalid')
    for(const row of rows){validId(row.key);if(!m[kind].some(r=>r.key===row.key))fail('expert_remote_invalid')}
  }
  for(const r of refs.skills)if(Object.keys(r).some(k=>!['key','skill_id','version_id','sha256'].includes(k))||!uuid(r.skill_id)||!uuid(r.version_id)||!sha(r.sha256))fail('expert_remote_invalid')
  for(const r of refs.connectors){
    if(Object.keys(r).some(k=>!['key','connector_id','tools','reference_version','tool_contracts','capability_contracts'].includes(k))||!uuid(r.connector_id))fail('expert_remote_invalid')
    if(r.tools!=null&&(v.contract_version===1||!Array.isArray(r.tools)||r.tools.length>2000||r.tools.some(t=>!string(t,200)||!t)||new Set(r.tools).size!==r.tools.length))fail('expert_remote_invalid')
    if(r.reference_version!=null&&r.reference_version!==3)fail('expert_remote_unsupported')
    if(r.reference_version===3){if(!r.capability_contracts||typeof r.capability_contracts!=='object'||Array.isArray(r.capability_contracts))fail('expert_remote_unverified');for(const [kind,rows] of Object.entries(r.capability_contracts)){if(!['tools','prompts','resources','templates'].includes(kind)||!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>2000)fail('expert_remote_invalid');for(const [key,proof] of Object.entries(rows)){if(!string(key,2048)||!key||!proof||Object.keys(proof).some(k=>!['contract','behavior'].includes(k))||!sha(proof.contract)||!sha(proof.behavior))fail('expert_remote_invalid')}}}
  }
  if(new Set(refs.skills.map(r=>r.skill_id)).size!==refs.skills.length||new Set(refs.connectors.map(r=>r.connector_id)).size!==refs.connectors.length)fail('expert_remote_invalid')
  if(hash(canonical({ manifest:v.manifest,dependency_refs:refs }))!==v.release.sha256)fail('expert_remote_checksum')
  return v
}
export function expertEndpoint(baseUrl:string,e:RemoteEnvelope,key:string,endpoint:string){
  const ref=e.dependency_refs.connectors.find(r=>r.key===key);if(!ref)fail('expert_remote_invalid')
  const expected=new URL(`/api/mcp/services/${ref.connector_id}/experts/${e.expert_id}/releases/${e.release.id}/${key}`,baseUrl).href
  if(endpoint!==expected)fail('expert_remote_endpoint')
  return expected
}
