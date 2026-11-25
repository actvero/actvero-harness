/** Workbench catalog entry for the permanent navigation rail. */
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from './register.ts'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import styles from './navigation.module.css'

/** Reactive catalog and current selection shared by navigation and business views. */
export type WorkbenchViewHooks = PropsHooks<{ view: {
  getSnapshot: () => WorkbenchView
  subscribe: (listener: () => void) => () => void
} }>

/** Opens the catalog and highlights the same icon for a workbench business view.
 * @param props Localized catalog action and active panel selector.
 * @returns The workbench entry in the permanent navigation rail.
 */
export function Navigation({ t, active, onOpen, usePanelInfo }: PropsRuntime<'sidebar.panellist.row'> & PropsLocale<'actvero.workbenches'>) {
  const inBusiness = usePanelInfo(info => info.activePanelId === 'actvero-workbench-business')
  return <Tooltip label={t('title')} portal side="right">
    <button type="button" className={styles.manage} aria-label={t('title')} aria-current={active || inBusiness ? 'page' : undefined}
      onClick={onOpen}><WorkbenchIcon size={18} /></button>
  </Tooltip>
}
