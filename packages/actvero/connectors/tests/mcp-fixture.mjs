import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListResourceTemplatesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
export function fixture(onCall=()=>{}) {
 const server=new Server({name:'local-acceptance',version:'1.0.0'},{capabilities:{tools:{listChanged:true},prompts:{listChanged:true},resources:{listChanged:true}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description:'Echo acceptance input',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]}));
 server.setRequestHandler(CallToolRequestSchema,async req=>{onCall(req);return {content:[{type:'text',text:String(req.params.arguments?.text??process.env.ACCEPTANCE_LABEL??'ok')}],structuredContent:{accepted:true,project_id:req.params._meta?.['actvero/project_id']??null}};});
 server.setRequestHandler(ListPromptsRequestSchema,async()=>({prompts:[{name:'report',arguments:[{name:'topic',required:true}]}]}));
 server.setRequestHandler(GetPromptRequestSchema,async req=>({description:'Report',messages:[{role:'user',content:{type:'text',text:`Report: ${req.params.arguments?.topic}`}}]}));
 server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:'acceptance://notes',name:'Notes',mimeType:'text/plain'}]}));
 server.setRequestHandler(ListResourceTemplatesRequestSchema,async()=>({resourceTemplates:[{uriTemplate:'acceptance://notes/{name}',name:'Named notes'}]}));
 server.setRequestHandler(ReadResourceRequestSchema,async req=>({contents:[{uri:req.params.uri,mimeType:'text/plain',text:'Acceptance resource'}]}));
 return server;
}
if(process.argv.includes('--stdio'))await fixture().connect(new StdioServerTransport());
