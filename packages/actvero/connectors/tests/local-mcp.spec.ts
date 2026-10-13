import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { LocalConnectors } from '../src/local-mcp.ts'
import { parseConfigurations } from '../src/local-config.ts'
import { LocalOAuth } from '../src/local-oauth.ts'
import { Connectors } from '../src/main.ts'
// @ts-expect-error Test fixture is shared with packaged desktop smoke tests.
import { fixture } from './mcp-fixture.mjs'
const create=()=>{let saved:unknown;const local=new LocalConnectors({ load:async()=>saved,save:async (value)=>{saved=structuredClone(value)},openExternal:async()=>{} },()=>{});return { local,get saved(){return saved} };}
const stdio={ name:'Acceptance',transport:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./mcp-fixture.mjs',import.meta.url)),'--stdio'],env:{ ACCEPTANCE_LABEL:'local-secret-value' } }
test('JSON parsing is inert, validates unknown fields and batches conflicts without exposing secrets',async()=>{
  assert.equal(parseConfigurations('{"mcpServers":{"remote":{"url":"https://example.com/mcp","headers":{"X-Token":"secret"}},"local":{"command":"node","args":["s.js"]}}}').length,2)
  assert.throws(()=>parseConfigurations('{"name":"x","command":"node","shell":true}'),/unsupported_config_fields/)
  assert.throws(()=>parseConfigurations('{"name":"x","url":"file:///etc/hosts"}'),/invalid_url/)
  assert.throws(()=>parseConfigurations('{"name":"x","url":"https://example.com","headers":{"Host":"evil"}}'),/reserved_header/)
  assert.throws(()=>parseConfigurations('{\n "mcpServers": nope}'),/json_syntax_line_/)
  const { local }=create();try{const preview=await local.parse(JSON.stringify({ mcpServers:{ first:{ command:'command-that-does-not-exist',env:{ TOKEN:'private' } } } }));assert.equal((await local.list()).length,0);assert.ok(!JSON.stringify(preview).includes('private'));await local.dispatch('localDiscard',{ token:preview.token });await assert.rejects(local.import(preview.token,[0]),/preview_expired/)}finally{await local.dispose()}
})
test('stdio discovers and invokes tools, prompts, resources, templates; switches remove session access and restarts persist',async()=>{
  const storage=create(),{ local }=storage
  try{
    const row=await local.save(stdio);assert.equal(row.status,'connected');assert.equal(row.env.ACCEPTANCE_LABEL,'')
    await local.state('conversation');const snapshot=await local.snapshot();assert.equal(snapshot[0]!.inventory.tools[0]!.name,'echo');assert.equal(snapshot[0]!.inventory.prompts[0]!.name,'report');assert.equal(snapshot[0]!.inventory.resources.length,1);assert.equal(snapshot[0]!.inventory.resourceTemplates.length,1);assert.ok(snapshot[0]!.inventory.protocolVersion)
    const tool:any=await local.call(row.id,'conversation','tools/call',{ name:'echo' });assert.equal(tool.content[0]!.text,'local-secret-value');assert.equal(tool.structuredContent.accepted,true);assert.equal(tool.structuredContent.project_id,'conversation')
    const prompt:any=await local.call(row.id,'conversation','prompts/get',{ name:'report',arguments:{ topic:'local' } });assert.equal(prompt.messages[0]!.content.text,'Report: local')
    const resource:any=await local.call(row.id,'conversation','resources/read',{ uri:'acceptance://notes/demo' });assert.equal(resource.contents[0]!.text,'Acceptance resource')
    await local.select(row.id,'conversation',false);await assert.rejects(local.call(row.id,'conversation','tools/call',{ name:'echo' }),/connector_not_enabled/)
    await local.select(row.id,'conversation',true);await local.enable(row.id,false);assert.equal((await local.snapshot()).length,0);assert.equal((await local.list())[0]!.status,'disabled')
    await local.enable(row.id,true);assert.equal((await local.list())[0]!.status,'connected')
    await local.save({ ...row,keepSecrets:true,name:'Renamed' },row.id);assert.equal((storage.saved as any)[0]!.config.env.ACCEPTANCE_LABEL,'local-secret-value')
    await assert.rejects(local.save({ ...stdio,name:'Renamed' }),/name_conflict/)
    await local.remove(row.id);assert.deepEqual(await local.list(),[]);assert.deepEqual(storage.saved,[])
  }finally{await local.dispose()}
})
test('test closes its process without saving and failing commands are actionable',async()=>{
  const { local }=create();try{assert.deepEqual(await local.test(stdio),{ connected:true });assert.deepEqual(await local.list(),[]);await assert.rejects(local.test({ ...stdio,command:'/nonexistent/actvero-test-command' }),/command_not_found|connection_failed/)}finally{await local.dispose()}
})
async function remote(mode:'http'|'sse',auth:'none'|'bearer'|'headers'){
  let calls=0,deny=false;const transports=new Map<string,any>(),servers:any[]=[]
  const http=createServer(async(req,res)=>{try{
    const ok=auth==='none'||auth==='bearer'&&req.headers.authorization==='Bearer acceptance-token'||auth==='headers'&&req.headers['x-test-token']==='acceptance-header'
    if(!ok||deny){res.writeHead(401,{ 'Content-Type':'application/json' });res.end('{}');return}
    if(req.method==='GET'&&req.url==='/sse'){const transport=new SSEServerTransport('/messages',res);transports.set(transport.sessionId,transport);const server=fixture(()=>calls++);servers.push(server);await server.connect(transport);return}
    if(req.url?.startsWith('/messages')){const id=new URL(req.url,'http://localhost').searchParams.get('sessionId');const transport=transports.get(id!);if(!transport){res.writeHead(404);res.end();return}await transport.handlePostMessage(req,res);return}
    const id=req.headers['mcp-session-id'] as string;let transport=transports.get(id)
    if(!transport&&req.method==='POST'){transport=new StreamableHTTPServerTransport({ sessionIdGenerator:randomUUID });const server=fixture(()=>calls++);servers.push(server);await server.connect(transport);await transport.handleRequest(req,res);if(transport.sessionId)transports.set(transport.sessionId,transport);return}
    if(transport){await transport.handleRequest(req,res);return}res.writeHead(404);res.end()
  }catch{if(!res.headersSent)res.writeHead(500);res.end()}})
  await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));const port=(http.address() as any).port
  const { local }=create();try{const row=await local.save({ name:'Remote',transport:mode,url:`http://127.0.0.1:${port}/${mode==='sse'?'sse':'mcp'}`,auth,token:'acceptance-token',headers:{ 'X-Test-Token':'acceptance-header' } });assert.equal(row.status,'connected');assert.equal(row.token,'');assert.ok(!JSON.stringify(await local.list()).includes('acceptance-token'));await local.state('one');const snapshot=await local.snapshot();assert.equal(snapshot[0]!.inventory.prompts.length,1);assert.equal(snapshot[0]!.inventory.resourceTemplates.length,1);await local.call(row.id,'one','tools/call',{ name:'echo',arguments:{ text:'remote' } });assert.equal(calls,1);deny=true;await assert.rejects(local.call(row.id,'one','tools/call',{ name:'echo' }));assert.equal(calls,1,'failed authentication must not execute the tool');assert.equal((await local.snapshot()).length,0)}finally{await local.dispose();await Promise.all(servers.map(s=>s.close()));http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()))}
}
for(const mode of ['http','sse'] as const)for(const auth of ['none','bearer','headers'] as const)test(`${mode} ${auth}: full capability discovery and auth failure isolation`,()=>remote(mode,auth))
test('custom MCP stays usable without platform login through aggregate Main bridge',async()=>{
  let persisted:unknown;const main=new Connectors({ identity:()=>undefined,issue:async()=>{throw new Error('must not issue')},load:async()=>[],save:async()=>{},openExternal:async()=>{},changed:()=>{},local:{ load:async()=>persisted,save:async (v)=>{persisted=v},openExternal:async()=>{} } })
  try{const row:any=await main.dispatch('localSave',{ config:stdio });assert.equal((await main.hostSnapshot(['signed-out']))[0]!.id,row.id);assert.equal((await main.state('signed-out')).enabled[0]!,row.id);assert.equal((await main.state('signed-out')).ready.length,1);assert.equal((await main.dispatch('detail',{ id:row.id }) as any).name,stdio.name)}finally{await main.dispose()}
})
test('OAuth uses loopback state and PKCE; callback rejects wrong state and tokens stay out of the result view',async()=>{
  let issuer='',receivedVerifier='',challenge='';const http=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json')
    if(req.url?.startsWith('/.well-known/oauth-authorization-server')){res.end(JSON.stringify({ issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'] }));return}
    if(req.url==='/register'){res.end(JSON.stringify({ client_id:'local-client',redirect_uris:[] }));return}
    if(req.url==='/token'){let body='';for await(const chunk of req)body+=chunk;receivedVerifier=new URLSearchParams(body).get('code_verifier')??'';res.end(JSON.stringify({ access_token:'local-oauth-token',token_type:'Bearer',expires_in:3600,refresh_token:'local-refresh' }));return}
    res.writeHead(404);res.end('{}')
  });await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));issuer=`http://127.0.0.1:${(http.address() as any).port}`
  const provider=new LocalOAuth({},'',async (raw)=>{const url=new URL(raw);challenge=url.searchParams.get('code_challenge')??'';const target=new URL(url.searchParams.get('redirect_uri')!);target.searchParams.set('code','accepted');target.searchParams.set('state','invalid');assert.equal((await fetch(target)).status,400);target.searchParams.set('state',url.searchParams.get('state')!);assert.equal((await fetch(target)).status,200)})
  try{const data=await provider.authorize(issuer+'/mcp',new AbortController().signal);assert.equal(data.tokens?.access_token,'local-oauth-token');assert.ok(challenge);assert.ok(receivedVerifier.length>30);await assert.rejects(fetch(data.redirect!),/fetch failed/)}finally{http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()))}
})

test('slow secure storage does not overwrite a connected server with connecting state',async()=>{
  let local:LocalConnectors
  local=new LocalConnectors({ load:async()=>undefined,save:async()=>{await local.restore();await new Promise(r=>setTimeout(r,20))},openExternal:async()=>{} },()=>{})
  try{const row=await local.save(stdio);assert.equal(row.status,'connected');assert.equal((await local.list())[0]!.status,'connected')}finally{await local.dispose()}
})
test('OAuth authorization connects, refreshes rotated tokens durably and denies access after revocation',async()=>{
  let base='',accepted='oauth-first',refreshes=0,calls=0,saved:any;const transports=new Map<string,StreamableHTTPServerTransport>();const servers:any[]=[]
  const http=createServer(async(req,res)=>{try{
    if(req.url?.startsWith('/.well-known/oauth-authorization-server')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',response_types_supported:['code'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'] }));return}
    if(req.url==='/register'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ client_id:'registered-client',redirect_uris:[] }));return}
    if(req.url==='/token'){let raw='';for await(const c of req)raw+=c;const params=new URLSearchParams(raw);res.setHeader('Content-Type','application/json');if(params.get('grant_type')==='refresh_token'){refreshes++;if(accepted==='revoked'){res.writeHead(400);res.end(JSON.stringify({ error:'invalid_grant' }));return}res.end(JSON.stringify({ access_token:'oauth-next',refresh_token:'refresh-next',token_type:'Bearer',expires_in:3600 }))}else res.end(JSON.stringify({ access_token:'oauth-first',refresh_token:'refresh-first',token_type:'Bearer',expires_in:3600 }));return}
    if(req.url!=='/mcp'){res.writeHead(404);res.end();return}
    if(req.headers.authorization!==`Bearer ${accepted}`){res.writeHead(401,{ 'WWW-Authenticate':'Bearer','Content-Type':'application/json' });res.end('{}');return}
    const id=req.headers['mcp-session-id'] as string;let transport=transports.get(id);if(!transport&&req.method==='POST'){transport=new StreamableHTTPServerTransport({ sessionIdGenerator:randomUUID });const server=fixture(()=>calls++);servers.push(server);await server.connect(transport);await transport.handleRequest(req,res);if(transport.sessionId)transports.set(transport.sessionId,transport);return}if(transport){await transport.handleRequest(req,res);return}res.writeHead(404);res.end()
  }catch{if(!res.headersSent)res.writeHead(500);res.end()}});await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(http.address() as any).port}`
  const local=new LocalConnectors({ load:async()=>undefined,save:async (value)=>{saved=structuredClone(value)},openExternal:async (raw)=>{const url=new URL(raw),callback=new URL(url.searchParams.get('redirect_uri')!);callback.searchParams.set('state',url.searchParams.get('state')!);callback.searchParams.set('code','local-code');assert.equal((await fetch(callback)).status,200)} },()=>{})
  try{const config={ name:'OAuth server',transport:'http',url:base+'/mcp',auth:'oauth' };const authorization=await local.authorize(config);assert.deepEqual(Object.keys(authorization),['authDraft']);const row=await local.save(config,undefined,authorization.authDraft);assert.equal(row.status,'connected');assert.ok(!JSON.stringify(row).includes('oauth-first'));await local.state('oauth-session');accepted='oauth-next';await local.call(row.id,'oauth-session','tools/call',{ name:'echo' });assert.equal(calls,1);assert.equal(refreshes,1);assert.equal(saved[0]!.oauth.tokens.refresh_token,'refresh-next');accepted='revoked';await assert.rejects(local.call(row.id,'oauth-session','tools/call',{ name:'echo' }));assert.equal(calls,1);assert.equal((await local.snapshot()).length,0)}finally{await local.dispose();await Promise.all(servers.map(s=>s.close()));http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()))}
})
test('cancel OAuth closes the loopback listener without storing a configuration',async()=>{
  let base='',controller=new AbortController(),redirect='';const http=createServer((req,res)=>{if(req.url?.startsWith('/.well-known/oauth-authorization-server')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],code_challenge_methods_supported:['S256'] }))}else{res.writeHead(404);res.end()}});await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(http.address() as any).port}`;const oauth=new LocalOAuth({},'pre-registered',async (raw)=>{redirect=new URL(raw).searchParams.get('redirect_uri')!;controller.abort()});try{await assert.rejects(oauth.authorize(base+'/mcp',controller.signal),/authorization_cancelled|abort/i);await assert.rejects(fetch(redirect));assert.equal(oauth.data.tokens,undefined)}finally{http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()))}
})

test('portable templates allow pinned launchers, redact credentials and never start during disabled import',async()=>{const { local }=create();try{const config={ name:'Portable',transport:'stdio',command:'npx',args:['-y','@example/notes@1.2.3'],env:{ TOKEN:'' } };const row=await local.saveDisabled(config);assert.equal(row.enabled,false);assert.equal(row.status,'disabled');assert.deepEqual((await local.portable(row.id) as { args:string[] }).args,config.args);for(const unsafe of [{ ...config,command:'/private/node' },{ ...config,args:['-y','package@latest'] },{ ...config,env:{ TOKEN:'secret' } },{ name:'Query',url:'https://example.com/mcp?token=secret' },{ name:'URL password',url:'https://user:secret@example.com/mcp' }])assert.throws(()=>local.template(unsafe),/unsafe_template|invalid_url/);const remote=await local.saveDisabled({ name:'Remote template',url:'https://example.com/mcp',auth:'bearer',headers:{ 'X-Token':'' } });assert.equal(remote.hasToken,false);assert.equal(remote.enabled,false);assert.equal((await local.snapshot()).length,0)}finally{await local.dispose()}})
