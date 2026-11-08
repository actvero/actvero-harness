import type {} from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { LocaleNamespaceMap, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchDisplayRequest, WorkbenchDisplayState, WorkbenchDocument, WorkbenchEnvironment, WorkbenchInstanceId, WorkbenchModelCatalog } from './types.ts'

/** Public account identity; credentials remain with the desktop host. */
export interface WorkbenchAccount {
  user: { id: string; name: string }
  organization: { tenantId: string; name: string } | null
}

/** Host capabilities for one rendered workbench instance. */
export interface WorkbenchClientContext {
  instanceId: WorkbenchInstanceId | null
  sessionId: SessionId | null
  resourceAddress: string | null
  /** Read the current signed-in identity, or null when unavailable. */
  account(): Promise<WorkbenchAccount | null>
  /** Read the current account's model directory after the Host provider declares models:read.
   * @returns Public model metadata; failures reject with workbench/platform and a stable code.
   */
  models(): Promise<WorkbenchModelCatalog>
  /** Resolve managed runtime paths without starting AI; null for UI-only workbenches. Paths grant no filesystem permissions. */
  environment(): Promise<WorkbenchEnvironment | null>
  /** Open or create the associated native conversation. */
  conversation(): Promise<void>
  /** Display this workbench through native navigation without sending a message.
   * @param options Presentation choices for this instance and its associated conversation.
   * @returns Mounted view; unconfirmed outcomes reject with workbench/display and a typed status.
   */
  display(options: Omit<WorkbenchDisplayRequest, 'id' | 'sessionId'>): Promise<WorkbenchDisplayState>
  /** Read the actual foreground view without starting AI or changing navigation.
   * @returns Mounted host view; throws when its workbench renderer has failed.
   */
  displayState(): WorkbenchDisplayState
  /** Commit a provider-defined operation at the last observed revision. */
  action(revision: number, action: string, args: string): Promise<WorkbenchDocument>
}

/** Native view props; useResource observes authoritative business data. */
export type WorkbenchBodyProps = PropsRuntime<'actvero.workbench.body'>

/** Card metadata declared by an installed Actvero workbench client. */
export interface ActveroWorkbench {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly category?: string
  /** Legacy public artwork URL; an installed package's icon takes precedence. No authentication tokens. */
  readonly iconUrl?: string
  /** Representative screenshots or outputs; the card displays the first three. */
  readonly previewUrls?: readonly string[]
  /** First-use defaults; saved user choices take precedence. Enabled AI restores a conversation unless ai is hide. */
  readonly display?: { sidebar?: 'preserve' | 'focus'; ai?: 'show' | 'hide' }
  readonly author?: string
  readonly tags?: readonly string[]
}

/** Client registry of installed workbenches with a ready business view. */
export interface ActveroWorkbenchRegistry {
  /** Register a business panel for the lifetime of its provider.
   * @param descriptor Card metadata and stable identity.
   * @param component Native business component rendered when the user opens the card.
   * @param options Native locale injection for this panel.
   * @returns Disposer that removes the card and business panel.
   */
  register<N extends keyof LocaleNamespaceMap | undefined = undefined>(
    descriptor: ActveroWorkbench, component: (props: WorkbenchBodyProps & PropsLocale<N>) => ReactNode, options?: { locale: N },
  ): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    actveroWorkbenches: ActveroWorkbenchRegistry
  }
}
import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Manager destinations supported by the desktop capability hub. */
export type CapabilityTab='experts'|'skills'|'connectors'
/** Temporary back action supplied by a manager detail view. */
export interface CapabilityBackNavigation { label:string; onBack():void }
/** Client navigation and notifications shared by capability managers. */
export interface CapabilityHub { open(tab:CapabilityTab):void;notify(text:string,tone?:'success'):void }
declare module '@deepseek-ai/cordis' { interface Context { capabilityHub:CapabilityHub } }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { 'actvero-workbench': WorkbenchDocument }
  interface SlotMap {
    /** Provider business view shared by the full page and floating preview. */
    'actvero.workbench.body': { kind: 'keyed'; scope: 'root'; entryKey: string; owner: { workbench: WorkbenchClientContext } }
    /** Connector-page brand mark; receives the pixel size and replaces the link icon fallback when occupied. */
    'actvero.connector.brand.mark':{ kind:'single';scope:'root';owner:{ size:number } }
    /**
     * Register a manager under its capability tab key. Components receive notification and optional back-navigation callbacks.
     * A registration replaces the same key's manager; an unoccupied tab shows the localized unavailable-content fallback.
     */
    'actvero.capability.content':{ kind:'keyed';scope:'root';entryKey:CapabilityTab;owner:{ notify(text:string,tone?:'success'):void;setBackNavigation?:(navigation:CapabilityBackNavigation|undefined)=>void } }
  }
}
