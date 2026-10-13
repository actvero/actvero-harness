import type { RemoteSnapshot } from './remote-types.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
export type ExpertCategory = 'office' | 'engineering' | 'design' | 'content' | 'data' | 'education' | 'lifestyle' | 'general'
export interface Requirement { key:string; label:string; required:boolean }
export interface ExpertManifest {
  schemaVersion:1; id:string; version:string; name:string; description:string
  avatar:string; category?:ExpertCategory; tags:string[]; instructions:string; conversationStarters:string[]
  skills:(Requirement & { load:'always'|'on_demand' })[]; connectors:Requirement[]
}
export interface Bindings { skills:Record<string,string>; connectors:Record<string,string> }
export interface Expert { manifest:ExpertManifest; bindings:Bindings; revision:number }
export interface SkillLock { key:string; id:string; versionId:string; digest:string; scope:string }
export interface ConnectorLock { key:string;id:string;digest:string;scope:string }
export interface ExpertLock { remote?:RemoteSnapshot; id:string; expert:Expert; skills:SkillLock[]; connectors:ConnectorLock[]; warnings:string[] }
export interface ExpertRuntime { snapshotId:string; expert:ExpertManifest; skills:(SkillDefinition & { load:'always'|'on_demand' })[]; connectors:string[]; warnings:string[] }
export interface DependencyOption { id:string;name:string;description:string;ready:boolean }
export interface DependencyCatalog { skills:DependencyOption[];connectors:DependencyOption[] }
export interface ExpertSelection { snapshotId:string;id:string;name:string;avatar:string;version:string }
export interface ExpertsBridge { request(action:string,input?:Record<string,unknown>):Promise<unknown>; subscribe(listener:()=>void):()=>void }
declare global {interface Window { actveroExperts?:ExpertsBridge }}
