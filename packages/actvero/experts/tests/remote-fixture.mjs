import {createHash} from 'node:crypto';
export const ids={expert:'11111111-1111-4111-8111-111111111111',release:'22222222-2222-4222-8222-222222222222',skill:'33333333-3333-4333-8333-333333333333',other:'44444444-4444-4444-8444-444444444444',version:'55555555-5555-4555-8555-555555555555',service:'66666666-6666-4666-8666-666666666666'};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const sha=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function remoteFixture(){
 const identity={key:'platform|tenant|member',baseUrl:'http://localhost:5294',available:true};
 const manifest={schemaVersion:1,id:ids.expert,version:'1.0.0',name:'远程周报专家',description:'整理测试资料，生成周报',avatar:'',category:'general',tags:['工作周报','资料检索'],instructions:'REMOTE_PERSONA',conversationStarters:['帮我整理本周工作'],skills:[{key:'weekly',label:'周报技能',required:true,load:'always'},{key:'summary',label:'摘要技能',required:false,load:'on_demand'}],connectors:[{key:'notes',label:'测试资料',required:true}]};
 const refs={skills:[{key:'weekly',skill_id:ids.skill,version_id:ids.version,sha256:'a'.repeat(64)},{key:'summary',skill_id:ids.other,version_id:ids.version,sha256:'b'.repeat(64)}],connectors:[{key:'notes',connector_id:ids.service,reference_version:3,tools:['search_documents'],capability_contracts:{tools:{search_documents:{contract:'c'.repeat(64),behavior:'d'.repeat(64)}},prompts:{weekly:{contract:'c'.repeat(64),behavior:'d'.repeat(64)}},resources:{'test://notes':{contract:'c'.repeat(64),behavior:'d'.repeat(64)}},templates:{'test://{id}':{contract:'c'.repeat(64),behavior:'d'.repeat(64)}}}}]};
 const wire={contract_version:3,expert_id:ids.expert,name:manifest.name,description:manifest.description,avatar:'',tags:manifest.tags,category:{id:'dynamic-engineering',name:'工程开发'},metadata_revision:1,release:{id:ids.release,version:'1.0.0',sha256:sha({manifest,dependency_refs:refs})},manifest,dependency_refs:refs};
 const state={visible:true,conflict:false,releaseChanged:false,optionalDenied:false,skillChanged:false,network:false,badEndpoint:false,badDigest:false,rogueTool:false,tokenExpired:false};
 const calls=[],installed=new Map();let installs=0;
 const skills={hasVersion:async(id,version,digest)=>installed.get(id)?.version.id===version&&installed.get(id)?.version.sha256===digest,state:async()=>({available:true,items:[...installed.values()],busy:[],checkFailed:false}),detail:async(id)=>{if(id===ids.other&&state.optionalDenied)throw Error('denied');return {current_version:{id:state.skillChanged?'changed':ids.version,sha256:id===ids.skill?'a'.repeat(64):'b'.repeat(64)}};},install:async(id,version,digest)=>{installs++;const exact={id:version,version:'1.0.0',sha256:digest,size:0,published_at:'',release_notes:''};installed.set(id,{skill:{id,name:id===ids.skill?'remote-report':'remote-summary',display_name:'Test skill',description:'Test skill',category:{id:'general',name:'General'},icon:{source:'',image:'',sha256:''},revision:1,current_version:exact},version:exact,enabled:true,status:'current'});},enable:async(id,enabled)=>{installed.get(id).enabled=enabled;},hostList:async()=>[...installed].filter(([,v])=>v.enabled).map(([id,v])=>({id,versionId:v.version.id,name:id===ids.skill?'remote-report':'remote-summary',description:'Test skill',invocation:{userInvocable:true,modelInvocable:true}})),hostGet:async(id,version)=>installed.get(id)?.enabled&&installed.get(id).version.id===version?{name:id===ids.skill?'remote-report':'remote-summary',description:'Test skill',content:id===ids.skill?'REMOTE_ALWAYS_BODY':'REMOTE_ON_DEMAND_BODY',source:'actvero',provider:'actvero-skills',invocation:{userInvocable:true,modelInvocable:true}}:undefined};
 const releases=new Map();
 const endpoint=(release=wire.release.id)=>`${identity.baseUrl}/api/mcp/services/${ids.service}/experts/${ids.expert}/releases/${release}/notes`;
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 const issue=async(resource)=>({access_token:resource,resource,scope:resource==='experts:catalog'?'experts:read':'mcp:read',token_type:'Bearer',expires_in:599,endpoint:identity.baseUrl+(resource==='experts:catalog'?'/api/v1/desktop/experts':resource==='mcp:catalog'?'/api/v1/desktop/mcp/connectors':'/api/mcp/services/'+resource.slice(4))});
 const fetcher=async(input,init)=>{if(state.network)throw Error('offline');const url=new URL(String(input)),body=init?.body?JSON.parse(init.body):undefined;calls.push({path:url.pathname,method:init?.method,body});
  if(state.tokenExpired&&url.pathname.includes('/desktop/experts')){state.tokenExpired=false;return json({},401);}
  if(url.pathname==='/api/v1/desktop/experts/categories')return json([{...wire.category,count:state.visible?1:0}]);
  if(url.pathname==='/api/v1/desktop/experts')return json({items:state.visible?[wire]:[],page:Number(url.searchParams.get('page')??1),page_size:20,total:state.visible?1:0});
  if(url.pathname.endsWith('/check-updates'))return json({items:[{expert_id:ids.expert,status:!state.visible?'unavailable':state.conflict||body.items[0].release_id!==wire.release.id?'update_available':'current',expert:state.visible?wire:null}]});
  if(url.pathname.endsWith('/adopt'))return json({adopted:true});
  if(url.pathname.endsWith('/resolve')){if(!state.visible)return json({},404);if(state.releaseChanged)return json({},409);const release=body.release_id===wire.release.id?wire:releases.get(body.release_id);if(!release||body.sha256!==release.release.sha256)return json({},409);return json({release_id:release.release.id,sha256:release.release.sha256,checked_at:new Date().toISOString(),update_available:state.conflict||release.release.id!==wire.release.id,can_prepare:!state.skillChanged,dependencies:[...release.dependency_refs.skills.map((r,i)=>({kind:'skills',key:r.key,required:i===0,status:state.skillChanged?'version_conflict':i===1&&state.optionalDenied?'unavailable':'available',action:i===1&&state.optionalDenied?'contact_admin':'none',resource_id:r.skill_id,version_id:r.version_id,sha256:r.sha256})),{kind:'connectors',key:'notes',required:true,status:'available',action:'none',resource_id:ids.service,mcp_endpoint:state.badEndpoint?'https://evil.example/mcp':endpoint(release.release.id),tools:release.dependency_refs.connectors[0].tools}]});}
  if(url.pathname==='/api/v1/desktop/experts/'+ids.expert)return state.visible?json(state.badDigest?{...wire,release:{...wire.release,sha256:'0'.repeat(64)}}:wire):json({},404);
  if(url.pathname==='/api/v1/desktop/mcp/connectors/'+ids.service)return json({id:ids.service,name:'资料',display_name:'资料',description:'Test',connection:{status:'connected',action:'none'},auth_mode:'none'});
  const releaseId=url.pathname.split('/releases/')[1]?.split('/')[0];
  if(releaseId&&(releaseId===wire.release.id||releases.has(releaseId))&&url.href===endpoint(releaseId)){
   const release=releaseId===wire.release.id?wire:releases.get(releaseId);
   if(!state.visible)return json({},404);const method=body.method;
   if(method==='notifications/initialized')return new Response(null,{status:202});
   let result;
   if(method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{},prompts:{},resources:{}}};
   if(method==='tools/list')result={tools:(state.rogueTool?['delete_everything']:release.dependency_refs.connectors[0].tools??['search_documents','sum_numbers']).map(name=>({name,description:'Test tool',inputSchema:{type:'object',properties:{}}}))};
   if(method==='prompts/list')result={prompts:[{name:'weekly',description:'Test prompt',arguments:[]}]};
   if(method==='resources/list')result={resources:[{uri:'test://notes',name:'Notes'}]};
   if(method==='resources/templates/list')result={resourceTemplates:[{uriTemplate:'test://{id}',name:'Test'}]};
   if(method==='tools/call')result={content:[{type:'text',text:'REMOTE_MCP_RESULT'}]};
   if(method==='prompts/get')result={messages:[{role:'user',content:{type:'text',text:'REMOTE_PROMPT'}}]};
   if(method==='resources/read')result={contents:[{uri:'test://notes',text:'REMOTE_RESOURCE'}]};
   return json({jsonrpc:'2.0',id:body.id,result});
  }
  throw Error('Unexpected transport '+url.pathname);
 };
 return {identity,state,wire,refs,calls,skills,issue,fetcher,endpoint,installed,get installs(){return installs;},publish(id,version){releases.set(wire.release.id,structuredClone(wire));wire.release={id,version,sha256:''};manifest.version=version;wire.release.sha256=sha({manifest,dependency_refs:refs});},rehash(){wire.release.sha256=sha({manifest,dependency_refs:refs});}};
}
