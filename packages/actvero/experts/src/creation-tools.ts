import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Create local expert tools using the Main-owned operation gateway.
 * @param request - closed local expert operations, without credentials.
 * @returns tool declarations whose model arguments are validated before dispatch.
 */
export function creationTools(request:(action:'catalog'|'create',input:Record<string,unknown>)=>Promise<unknown>){
  return [
    { name:'expert_catalog',description:'List exact IDs of installed skills and configured MCP connections available for creating a local ACTVERO expert. Does not connect or install anything.',parameters:{ type:'object',properties:{},additionalProperties:false },output:{ schema:{ type:'string' },render:(_args,value)=>[{ type:'text',text:String(value) }] },execute:async(args)=>{if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw new Error('expert_invalid');return JSON.stringify(await request('catalog',{}))} },
    { name:'expert_create',description:'Create a NEW local ACTVERO expert after the user requests one. Load expert-creator first. Does not modify existing experts, install skills or enable MCP connections.',parameters:{ type:'object',properties:{ configuration:{ type:'string',maxLength:700000,description:'JSON with manifest and bindings following expert-creator. IDs must come from expert_catalog.' } },required:['configuration'],additionalProperties:false },output:{ schema:{ type:'string' },render:(_args,value)=>[{ type:'text',text:String(value) }] },execute:async(args)=>{if(!args||typeof args!=='object'||Array.isArray(args)||!('configuration' in args)||typeof args.configuration!=='string'||Object.keys(args).length!==1||args.configuration.length>700000)throw new Error('expert_invalid');return JSON.stringify(await request('create',{ expert:JSON.parse(args.configuration) }))} },
  ] satisfies ToolDefinition[]
}
