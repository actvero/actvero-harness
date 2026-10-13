/** JSON values accepted by MCP schemas and request metadata. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json }
/** Platform connection status and the next action available to the user. */
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
/** Catalog metadata and connection state for one platform MCP service. */
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
/** One page of platform connectors visible to the current account. */
export interface Catalog {
  items: Connector[]
  total: number
  page: number
  page_size: number
}
/** MCP capability metadata returned by discovery for tools, prompts and resources. */
export interface Capability {
  name?: string
  description?: string
  inputSchema?: Record<string, Json>
  arguments?: { name: string; description?: string; required?: boolean }[]
  uri?: string
  uriTemplate?: string
  mimeType?: string
}
/** Discovered MCP capabilities and their negotiated protocol version. */
export interface Inventory {
  tools: Capability[]
  prompts: Capability[]
  resources: Capability[]
  resourceTemplates: Capability[]
  protocolVersion: string
}
/** Added, session-enabled and currently ready connector identifiers. */
export interface LocalView {
  added: string[]
  enabled: string[]
  ready: string[]
}
/** Short-lived resource credential used only by the Main-owned MCP client. */
export interface ResourceToken {
  access_token: string
  token_type: string
  resource: string
  endpoint: string
  scope: string
  expires_in: number
}
/** Platform/account/organization scope used to isolate connector authority. */
export interface Identity {
  key: string
  baseUrl: string
  available: boolean
}
/** Renderer bridge for connector actions and refresh notifications; owns no credentials. */
export interface ConnectorBridge {
  request(action: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(listener: () => void): () => void
}
declare global {
  interface Window {
    actveroConnectors?: ConnectorBridge
  }
}
