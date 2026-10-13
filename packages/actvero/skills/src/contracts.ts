import type { SkillDefinition } from '@deepseek-ai/dsh-skill'

/** Verified installed skill whose entrypoint and resources are available on disk. */
export interface InstalledSkillDefinition extends SkillDefinition {
  path: string
  resourceBase: { kind: 'directory'; path: string }
}

/** Immutable platform skill release metadata used to verify downloaded bytes. */
export interface SkillVersion {
  id: string
  version: string
  sha256: string
  size: number
  published_at: string
  release_notes: string
}
/** Local or platform catalog metadata with the currently advertised release. */
export interface Skill {
  source?: 'platform' | 'local'
  id: string
  name: string
  display_name: string
  description: string
  category: { id: string; name: string }
  icon: { source: string; image: string; sha256: string }
  revision: number
  current_version: SkillVersion
}
/** Archive member metadata used for digest checks and file previews. */
export interface SkillFile {
  path: string
  size: number
  sha256: string
  previewable: boolean
}
/** Skill catalog entry plus its entrypoint text and complete file inventory. */
export interface SkillDetail extends Skill {
  skill_md: string
  entrypoint: string
  files: SkillFile[]
}
/** One page of platform skills visible to the current account. */
export interface Catalog {
  items: Skill[]
  total: number
  page: number
  page_size: number
}
/** Platform skill category and its matching catalog count. */
export interface Category {
  id: string
  name: string
  count: number
}
/** Managed skill installation, selected release and execution availability. */
export interface Installed {
  skill: Skill
  version: SkillVersion
  enabled: boolean
  status: 'current' | 'update_available' | 'unavailable'
}
/** Installation view combining device-local packages with the current account scope. */
export interface LocalState {
  scope?: string
  available: boolean
  items: Installed[]
  busy: string[]
  checkFailed: boolean
}
/** Platform/account/organization identity used to partition skill installations. */
export interface Identity {
  key: string
  baseUrl: string
  available: boolean
}
/** Short-lived platform skills credential retained only by Electron Main. */
export interface ResourceToken {
  access_token: string
  token_type: string
  resource: string
  endpoint: string
  scope: string
  expires_in: number
}
/** Expiring local import token and the validated skill details shown before installation. */
export interface ImportPreview {
  token: string
  filename: string
  skill: SkillDetail
}
/** Renderer requests, optional dropped-file preview and installation notifications. */
export interface SkillsBridge {
  previewDrop?(file: File): Promise<ImportPreview>
  request(action: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(listener: () => void): () => void
}
declare global {
  interface Window {
    actveroSkills?: SkillsBridge
  }
}
