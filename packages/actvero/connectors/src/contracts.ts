export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json }
export interface Connection {
  status:
    | 'not_connected'
    | 'unverified'
    | 'connected'
    | 'reauthorization_required'
    | 'error'
  action: 'none' | 'configure' | 'authorize' | 'contact_admin' | 'retry'
  checked_at: string | null
  error_code: string | null
}
export interface Connector {
  id: string
  name: string
  display_name: string
  description: string
  icon: string | null
  examples: string[]
  auth_mode: 'none' | 'organization' | 'personal' | 'oauth'
  credential_fields: { key: string; label: string }[]
  connection: Connection
  counts: Record<string, number>
  endpoint: string
}
export interface Catalog {
  items: Connector[]
  total: number
  page: number
  page_size: number
}
export interface Capability {
  name?: string
  description?: string
  inputSchema?: Record<string, Json>
  arguments?: { name: string; description?: string; required?: boolean }[]
  uri?: string
  uriTemplate?: string
  mimeType?: string
}
export interface Inventory {
  tools: Capability[]
  prompts: Capability[]
  resources: Capability[]
  resourceTemplates: Capability[]
  protocolVersion: string
}
export interface LocalView {
  added: string[]
  enabled: string[]
  ready: string[]
}
export interface ResourceToken {
  access_token: string
  token_type: string
  resource: string
  endpoint: string
  scope: string
  expires_in: number
}
export interface Identity {
  key: string
  baseUrl: string
  available: boolean
}
export interface ConnectorBridge {
  request(action: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(listener: () => void): () => void
}
declare global {
  interface Window {
    actveroConnectors?: ConnectorBridge
  }
}
