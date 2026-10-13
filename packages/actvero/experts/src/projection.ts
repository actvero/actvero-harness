/** Durable expert selection and blank-session state, restored by the native projection registry. */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ExpertSelection } from './contracts.ts'
import { z } from 'zod'
import { normalizeExpertSelectionAvatar } from './avatar.ts'
export interface ExpertProjection { hasSelection:boolean;selection:ExpertSelection|null;started:boolean }
declare module '@deepseek-ai/dsh-session/types' {interface SessionEventMap {
  /** Exact expert snapshot chosen for this session. Null clears the selection; resume and forks retain the recorded snapshot rather than adopting a newer release. */
  'actvero/expert':{ schemaVersion:1;selection:ExpertSelection|null }
}}
declare module '@deepseek-ai/dsh-session-projection/types' {interface SessionProjectionStateMap { actveroExpert:ExpertProjection }}
const selection=z.object({ snapshotId:z.string().uuid(),id:z.string().min(1).max(128),name:z.string().min(1).max(200),avatar:z.string().transform(normalizeExpertSelectionAvatar),version:z.string().min(1).max(100) }).strict().nullable()
const state=z.object({ hasSelection:z.boolean(),selection,started:z.boolean() }).strict()
export const expertProjection={ key:'actveroExpert',stateSchema:state,init:()=>({ hasSelection:false,selection:null,started:false }),apply:(previous,event)=>{if(event.type==='actvero/expert'){if(event.data.schemaVersion!==1)throw new Error('expert_snapshot_invalid');return { ...previous,hasSelection:true,selection:selection.parse(event.data.selection) }}if(['turn/start','user/message','assistant/message'].includes(event.type)&&!previous.started)return { ...previous,started:true };return previous},stateVersion:1 } satisfies ProjectionDefinition<'actveroExpert',ExpertProjection>

/** Conversation intent is separate from availability; scopes prevent account/tenant reuse. */
export interface ConnectorChoice { scope:string;id:string;enabled:boolean }
/** Last recorded conversation choices, including choices for unavailable connections. */
export interface ConnectorProjection { choices:ConnectorChoice[] }
declare module '@deepseek-ai/dsh-session/types' {interface SessionEventMap {
  /** Durable conversation choices; a required expert dependency overrides a recorded off choice. */
  'actvero/connectors':{ schemaVersion:1;choices:ConnectorChoice[] }
}}
declare module '@deepseek-ai/dsh-session-projection/types' {interface SessionProjectionStateMap { actveroConnectors:ConnectorProjection }}
/** Validates scoped choices at the session-log and process input boundaries. */
export const connectorChoices=z.array(z.object({ scope:z.string().min(1).max(128),id:z.string().min(1).max(128),enabled:z.boolean() }).strict()).max(256).refine(rows=>new Set(rows.map(r=>r.scope+':'+r.id)).size===rows.length)
/** Restores conversation choices through replay and fork using the native registry. */
export const connectorProjection={ key:'actveroConnectors',stateSchema:z.object({ choices:connectorChoices }).strict(),init:()=>({ choices:[] }),apply:(previous,event)=>event.type==='actvero/connectors'?{ choices:connectorChoices.parse(event.data.schemaVersion===1?event.data.choices:null) }:previous,stateVersion:1 } satisfies ProjectionDefinition<'actveroConnectors',ConnectorProjection>
