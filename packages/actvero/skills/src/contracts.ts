export interface SkillVersion { id: string; version: string; sha256: string; size: number; published_at: string; release_notes: string }
export interface Skill {
  source?: 'platform' | 'local'; id: string; name: string; display_name: string; description: string
  category: { id: string; name: string }; icon: { source: string; image: string; sha256: string }
  revision: number; current_version: SkillVersion
}
export interface SkillFile { path: string; size: number; sha256: string; previewable: boolean }
export interface SkillDetail extends Skill { skill_md: string; entrypoint: string; files: SkillFile[] }
export interface Catalog { items: Skill[]; total: number; page: number; page_size: number }
export interface Category { id: string; name: string; count: number }
export interface Installed {
  skill: Skill; version: SkillVersion; enabled: boolean
  status: 'current' | 'update_available' | 'unavailable'
}
export interface LocalState { scope?:string; available: boolean; items: Installed[]; busy: string[]; checkFailed: boolean }
export interface Identity { key: string; baseUrl: string; available: boolean }
export interface ResourceToken { access_token: string; token_type: string; resource: string; endpoint: string; scope: string; expires_in: number }
export interface ImportPreview { token:string; filename:string; skill:SkillDetail }
export interface SkillsBridge {
  previewDrop?(file: File): Promise<ImportPreview>
  request(action: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(listener: () => void): () => void
}
declare global { interface Window { actveroSkills?: SkillsBridge } }
