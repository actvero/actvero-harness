/** Business components receive project data and narrow operations through the registered slot. */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchId, WorkbenchProject, WorkbenchData } from '../contracts.ts'
import type { WorkbenchClient } from './controller.ts'
import type { WorkbenchLocaleKey } from './locales.ts'

/** Business slot inputs; updates are revision checked and never send model requests. */
export interface BusinessOwner {
  project: WorkbenchProject
  busy: boolean
  update: (data: WorkbenchData, revision?: number) => Promise<boolean>
  assistant: () => void
}
/** Typed business slot properties and workbench translations. */
export type WorkbenchBusinessProps = PropsRuntime<'actvero.workbench.business'> & PropsLocale<'actvero.workbenches'>
declare module '@deepseek-ai/cordis' {
  interface Context {
    actveroWorkbenches: {
      register(id: WorkbenchId, component: SlotComponent<WorkbenchBusinessProps>): () => void
      open(id: WorkbenchId): Promise<void>
    }
  }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'actvero.workbenches': WorkbenchLocaleKey }
  interface SlotMap {
    /** Register native conversation content in the current Session area. Absence leaves the conversation body empty. */
    'actvero.workbench.conversation': { kind: 'single'; scope: 'session' }
    /** Register business content for a package; receives project data, saves and AI opening. Absence leaves the area empty. */
    'actvero.workbench.business': { kind: 'keyed'; scope: 'root'; entryKey: WorkbenchId; owner: BusinessOwner }
  }
}
/** Shared controller and observable navigation hook injected by the client plugin. */
export interface ControllerProps {
  controller: WorkbenchClient
  useWorkbench: <T>(selector: (state: ReturnType<WorkbenchClient['getSnapshot']>) => T) => T
}
