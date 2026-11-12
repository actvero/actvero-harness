import type {} from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { HandleOf, LocaleNamespaceMap, PropsLocale, PropsRenderFactories, PropsRuntime, PropsStore, StoreDecl, StoreFactory } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchObjectId, WorkbenchReferenceInput, WorkbenchReferenceSnapshot } from './workbench-reference.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
export type { WorkbenchObjectId, WorkbenchReferenceInput } from './workbench-reference.ts'
import type { WorkbenchConversationOptions, WorkbenchDisplayRequest, WorkbenchDisplayState, WorkbenchDocument, WorkbenchEnvironment, WorkbenchInstanceId, WorkbenchModelCatalog, WorkbenchObject } from './types.ts'
export type { WorkbenchConversationOptions, WorkbenchObject } from './types.ts'
export type { WorkbenchProtocol } from './workbench-protocol.ts'

/** Business navigation address; an optional revision identifies historical content, not a request to restore old data. */
export type WorkbenchObjectLocation = Pick<WorkbenchReferenceSnapshot, 'workbenchId' | 'instanceId' | 'objectId'> & {
  /** Historical content revision when navigation originates from a saved reference. */
  readonly revision?: string
}

/** Public account identity; credentials remain with the desktop host. */
export interface WorkbenchAccount {
  user: { id: string; name: string }
  organization: { tenantId: string; name: string } | null
}

/** Host capabilities for one rendered workbench instance. */
export interface WorkbenchClientContext {
  /** Explicit business object navigation; a saved reference also supplies its historical revision. */
  readonly location: WorkbenchObjectLocation | null
  instanceId: WorkbenchInstanceId | null
  sessionId: SessionId | null
  /** Object recorded for this conversation; navigation alone does not change it. */
  readonly object: WorkbenchObject | null
  resourceAddress: string | null
  /** Read the current signed-in identity, or null when unavailable. */
  account(): Promise<WorkbenchAccount | null>
  /** Read the current account's model directory after the Host provider declares models:read.
   * @returns Public model metadata; failures reject with workbench/platform and a stable code.
   */
  models(): Promise<WorkbenchModelCatalog>
  /** Resolve managed runtime paths without starting AI; null for UI-only workbenches. Paths grant no filesystem permissions. */
  environment(): Promise<WorkbenchEnvironment | null>
  /** Open or create the associated native conversation without sending a message.
   * @param options Explicit object choice; omitted to preserve the associated conversation, fresh to create another for that object.
   */
  conversation(options?: WorkbenchConversationOptions): Promise<void>
  /** Insert an immutable business snapshot into the associated native draft without sending it.
   * @param reference Object identity, author-defined revision and readable content captured by the caller.
   * @returns Target conversation. Native cancellation rejects with AbortError; local refusal uses workbench/reference with a stable status.
   * Remote failures retain their original code. No message is sent on failure.
   */
  reference(reference: WorkbenchReferenceInput): Promise<SessionId>
  /** Update the automatic selection chip in an already associated conversation; never opens AI or sends.
   * @param reference Snapshot captured in the selection event; null removes the managed chip only.
   * @returns Inactive without a conversation; dismissed after user removal/send until selection changes; busy when admission refuses.
   */
  selection(reference: WorkbenchReferenceInput | null): Promise<'attached' | 'cleared' | 'dismissed' | 'busy' | 'inactive'>
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

/** Author-rendered region after the host return control and divider, without an injected icon, title or navigation layout.
 * Never mounted in a floating preview.
 */
export type WorkbenchHeaderProps = PropsRuntime<'actvero.workbench.header'> & PropsRenderFactories

/** Native settings page props. Installation-wide settings use the provider's Host configuration; object data stays in its storage. */
export type WorkbenchSettingsProps = PropsRuntime<'settings.section'>

/** One ancestor or current business location; the last item is the current page. */
export interface WorkbenchBreadcrumb {
  /** Unique among this header's breadcrumbs. */
  readonly id: string
  readonly label: string
  /** Navigate to an ancestor without changing the associated conversation. */
  readonly onSelect?: () => void
}

/** Author-localized action shown in the native toolbar or its overflow menu. */
export interface WorkbenchToolbarAction {
  /** Unique among this header's actions. */
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  /** The owning operation reports failures; the host does not submit AI input on its behalf. */
  readonly onSelect: () => void
}

/** Optional legacy toolbar helper; custom headers own their layout and need not use this representation. */
export interface WorkbenchToolbarProps {
  readonly title: string
  readonly breadcrumbs?: readonly WorkbenchBreadcrumb[]
  readonly status?: { readonly text: string; readonly tone?: 'normal' | 'error' }
  readonly actions?: readonly WorkbenchToolbarAction[]
}

/** Card metadata declared by an installed Actvero workbench client. */
export interface ActveroWorkbench {
  /** Host API requirements shared with the Host registration; omitted for legacy packages. */
  readonly protocol?: import('./workbench-protocol.ts').WorkbenchProtocol
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
  /** Open a recorded business object without rebinding or submitting the originating conversation.
   * @param target Fixed provider, instance, object and historical revision.
   * @returns Resolves after the destination view is mounted; missing providers/objects reject and history remains readable.
   */
  openObject(target: WorkbenchObjectLocation): Promise<void>
  /** Open this provider's native settings page without binding or submitting a conversation.
   * @param id Registered workbench identity.
   * @throws When the provider has no settings page or the native settings shell is unavailable.
   */
  openSettings(id: string): void
  /** Register a business panel for the lifetime of its provider.
   * @param descriptor Card metadata and stable identity.
   * @param component Native business component rendered when the user opens the card.
   * @param options Native locale, shared view-state store, header, settings and commands. Store state holds navigation, not business data.
   * @returns Idempotent disposer removing contributions and open command menus; await it before re-registering.
   */
  register<N extends keyof LocaleNamespaceMap | undefined = undefined, H extends Exclude<StoreDecl, StoreFactory> | undefined = undefined>(
    descriptor: ActveroWorkbench, component: (props: WorkbenchBodyProps & PropsLocale<N> & PropsStore<HandleOf<H>>) => ReactNode,
    options?: {
      locale?: N
      store?: H
      /** The body renders workbench.location when historical navigation requests an object. */
      objectNavigation?: boolean
      /** Show the public catalog return control by default; hide it when the author supplies business navigation. */
      catalogButton?: 'show' | 'hide'
      /** Resolve the object for the native AI launcher, capturing its id before asynchronous preparation.
       * Return null for an instance-wide conversation. Omission resumes the existing association.
       * Rejection leaves the conversation closed and reports failure; navigation or disposal discards a pending result.
       */
      conversationTarget?: () => WorkbenchObjectId | null | Promise<WorkbenchObjectId | null>
      /** Render the entire business header. Authors own its identity, controls, responsive layout and navigation.
       * Omission uses the host's minimal name and icon.
       */
      header?: (props: WorkbenchHeaderProps & PropsLocale<N> & PropsStore<HandleOf<H>>) => ReactNode
      /** One installation-wide settings page. Omitted label uses the workbench name; functions follow locale changes. */
      settings?: {
        label?: () => string
        component: (props: WorkbenchSettingsProps & PropsLocale<N> & PropsStore<HandleOf<H>>) => ReactNode
      }
      /** Native slash commands with globally unique names; only associated conversations can discover or invoke them. */
      commands?: readonly CommandContribution[]
    },
  ): () => void | Promise<void>
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
    /** Full-page business header beside the optional host return control; keyed by the installed workbench id. */
    'actvero.workbench.header': { kind: 'keyed'; scope: 'root'; entryKey: string; owner: { workbench: WorkbenchClientContext; title: string } }
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
  interface SlotFactoryMap {
    /** Legacy opt-in toolbar helper; the header slot itself accepts author-owned components. */
    'actvero.workbench.toolbar': { scope: 'root'; props: WorkbenchToolbarProps; locale: 'actvero.workbenches' }
  }
}
