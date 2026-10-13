import type { RemoteSnapshot } from './remote-types.ts'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
/** Local expert categories accepted by the manifest validator. */
export type ExpertCategory =
  | 'office'
  | 'engineering'
  | 'design'
  | 'content'
  | 'data'
  | 'education'
  | 'lifestyle'
  | 'general'
/** Named dependency slot and whether preparation requires it. */
export interface Requirement {
  key: string
  label: string
  required: boolean
}
/** Versioned expert instructions, presentation and dependency requirements. */
export interface ExpertManifest {
  schemaVersion: 1
  id: string
  version: string
  name: string
  description: string
  avatar: string
  category?: ExpertCategory
  tags: string[]
  instructions: string
  conversationStarters: string[]
  skills: (Requirement & { load: 'always' | 'on_demand' })[]
  connectors: Requirement[]
}
/** Local resource identifiers assigned to the manifest dependency keys. */
export interface Bindings {
  skills: Record<string, string>
  connectors: Record<string, string>
}
/** Editable expert manifest and bindings with an optimistic revision counter. */
export interface Expert {
  manifest: ExpertManifest
  bindings: Bindings
  revision: number
}
/** Exact skill version, digest and account scope captured for an expert. */
export interface SkillLock {
  key: string
  id: string
  versionId: string
  digest: string
  scope: string
}
/** Connector identity and inventory digest captured for an expert. */
export interface ConnectorLock {
  key: string
  id: string
  digest: string
  scope: string
}
/** Immutable conversation snapshot containing the expert and its resolved dependencies. */
export interface ExpertLock {
  remote?: RemoteSnapshot
  id: string
  expert: Expert
  skills: SkillLock[]
  connectors: ConnectorLock[]
  warnings: string[]
}
/** Verified expert instructions and capabilities resolved from a saved snapshot. */
export interface ExpertRuntime {
  snapshotId: string
  expert: ExpertManifest
  skills: (SkillDefinition & { load: 'always' | 'on_demand' })[]
  connectors: string[]
  warnings: string[]
}
/** Selectable local resource with its preparation readiness. */
export interface DependencyOption {
  id: string
  name: string
  description: string
  ready: boolean
}
/** Skills and connectors available for binding a local expert. */
export interface DependencyCatalog {
  skills: DependencyOption[]
  connectors: DependencyOption[]
}
/** Conversation-visible identity of a selected immutable expert snapshot. */
export interface ExpertSelection {
  snapshotId: string
  id: string
  name: string
  avatar: string
  version: string
}
/** Renderer requests and change notifications for Main-owned expert operations. */
export interface ExpertsBridge {
  request(action: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(listener: () => void): () => void
}
declare global {
  interface Window {
    actveroExperts?: ExpertsBridge
  }
}
