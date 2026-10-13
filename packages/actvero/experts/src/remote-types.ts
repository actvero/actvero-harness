import type { ExpertManifest } from './contracts.ts'
export interface RemoteSummary {
  contract_version:1|2|3; expert_id:string; name:string; description:string; avatar:string; tags:string[]
  category:{ id:string;name:string }; metadata_revision:number
  release:{ id:string;version:string;sha256:string }
}
export interface RemoteEnvelope extends RemoteSummary {
  manifest:ExpertManifest
  dependency_refs:{ skills:{ key:string;skill_id:string;version_id:string;sha256:string }[];connectors:{ key:string;connector_id:string;tools?:string[]|null;reference_version?:3|null;tool_contracts?:Record<string,string>|null;capability_contracts?:Partial<Record<'tools'|'prompts'|'resources'|'templates',Record<string,{ contract:string;behavior:string }>>>|null }[] }
}
export interface RemoteSnapshot { scope:string;envelope:RemoteEnvelope;skills:string[];connectors:{ key:string;endpoint:string }[] }
export interface RemoteDependency {
  kind:'skills'|'connectors';key:string;required:boolean;status:string;action:string
  resource_id?:string;version_id?:string;sha256?:string;mcp_endpoint?:string;tools?:string[]
}
export interface RemotePlan { id:string;name:string;canPrepare:boolean;dependencies:{ kind:string;key:string;label:string;required:boolean;status:string;action:string }[] }
