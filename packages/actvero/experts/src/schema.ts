import { MAX_EXPERT_SELECTION_AVATAR_CHARS } from './avatar.ts'
import { expertCategories } from './categories.ts'
import type { Expert,ExpertManifest,Bindings,Requirement } from './contracts.ts'
/**
 * Throw an expert validation failure with a machine-readable code.
 * @param code - Stable expert diagnostic code.
 * @returns Never returns.
 */
export function fail(code:string):never {throw Object.assign(new Error(code),{ code })}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('expert_invalid');return v as Record<string,unknown>}
const text=(v:unknown,max:number,empty=false):string=>{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||v.includes('\0'))fail('expert_invalid');return v.trim()}
const keys=(v:Record<string,unknown>,names:string[])=>{if(Object.keys(v).some(k=>!names.includes(k)))fail('expert_invalid')}
/**
 * Validate a filesystem-safe expert or dependency identifier.
 * @param v - Untrusted identifier.
 * @returns Validated identifier; invalid or reserved names throw.
 */
export function validId(v:unknown):string {const s=text(v,80);if(!/^[a-zA-Z0-9_-]+$/.test(s)||['__proto__','constructor','prototype'].includes(s))fail('expert_invalid');return s}
const list=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)fail('expert_invalid');return v}
function requirements(v:unknown,skill=false){const rows=list(v,32).map((value)=>{const r=object(value);keys(r,['key','label','required',...(skill?['load']:[])]);if(typeof r.required!=='boolean')fail('expert_invalid');const row:Requirement={ key:validId(r.key),label:text(r.label,120),required:r.required };if(skill&&!['always','on_demand'].includes(String(r.load)))fail('expert_invalid');return { ...row,...(skill?{ load:r.load as 'always'|'on_demand' }:{}) }});if(new Set(rows.map(r=>r.key)).size!==rows.length)fail('expert_invalid');return rows}
/**
 * Validate expert metadata, instructions and dependency declarations.
 * @param value - Untrusted manifest object.
 * @returns Normalized manifest with supported defaults; invalid fields throw.
 */
export function parseManifest(value:unknown):ExpertManifest {
  const v=object(value);keys(v,['schemaVersion','id','version','name','description','avatar','category','tags','instructions','conversationStarters','skills','connectors'])
  if(v.schemaVersion!==1)fail('expert_schema_unsupported');const version=text(v.version,30);if(!/^\d+\.\d+\.\d+$/.test(version))fail('expert_invalid')
  const category=v.category??'general';if(!expertCategories.some(value=>value===category))fail('expert_invalid')
  const avatar=text(v.avatar??'',MAX_EXPERT_SELECTION_AVATAR_CHARS,true);if(avatar&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar))fail('expert_invalid')
  return { schemaVersion:1,id:validId(v.id),version,name:text(v.name,80),description:text(v.description,500),avatar,category:category as ExpertManifest['category'],tags:list(v.tags??[],8).map(x=>text(x,30)),instructions:text(v.instructions,64000),conversationStarters:list(v.conversationStarters??[],6).map(x=>text(x,1000)),skills:requirements(v.skills??[],true) as ExpertManifest['skills'],connectors:requirements(v.connectors??[]) }
}
/**
 * Validate bindings and reject keys absent from the manifest.
 * @param value - Untrusted skills/connectors binding object.
 * @param manifest - Validated dependency declarations.
 * @returns Bindings containing only declared dependency keys.
 */
export function parseBindings(value:unknown,manifest:ExpertManifest):Bindings {
  const v=object(value);keys(v,['skills','connectors']);const out:Bindings={ skills:{},connectors:{} }
  for(const kind of ['skills','connectors'] as const){const rows=object(v[kind]??{});for(const [key,id] of Object.entries(rows)){if(!manifest[kind].some(r=>r.key===key))fail('expert_invalid');out[kind][key]=validId(id)}}
  return out
}
/**
 * Validate an expert record and its nonnegative revision.
 * @param value - Untrusted stored or imported expert record.
 * @returns Validated manifest, bindings and revision.
 */
export function parseExpert(value:unknown):Expert {const v=object(value);keys(v,['manifest','bindings','revision']);const manifest=parseManifest(v.manifest);if(!Number.isSafeInteger(v.revision)||Number(v.revision)<0)fail('expert_invalid');return { manifest,bindings:parseBindings(v.bindings,manifest),revision:Number(v.revision) }}
