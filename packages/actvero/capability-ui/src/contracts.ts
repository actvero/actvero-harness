import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
/** Manager destinations supported by the desktop capability hub. */
export type CapabilityTab='experts'|'skills'|'connectors'
/** Temporary back action supplied by a manager detail view. */
export interface CapabilityBackNavigation { label:string; onBack():void }
/** Client navigation and notifications shared by capability managers. */
export interface CapabilityHub { open(tab:CapabilityTab):void;notify(text:string,tone?:'success'):void }
declare module '@deepseek-ai/cordis' { interface Context { capabilityHub:CapabilityHub } }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Connector-page brand mark; receives the pixel size and replaces the link icon fallback when occupied. */
    'actvero.connector.brand.mark':{ kind:'single';scope:'root';owner:{ size:number } }
    /**
     * Register a manager under its capability tab key. Components receive notification and optional back-navigation callbacks.
     * A registration replaces the same key's manager; an unoccupied tab shows the localized unavailable-content fallback.
     */
    'actvero.capability.content':{ kind:'keyed';scope:'root';entryKey:CapabilityTab;owner:{ notify(text:string,tone?:'success'):void;setBackNavigation?:(navigation:CapabilityBackNavigation|undefined)=>void } }
  }
}
