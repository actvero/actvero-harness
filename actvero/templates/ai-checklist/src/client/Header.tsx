/** The native header observes the same authoritative resource as the business view. */
import type { WorkbenchHeaderProps } from '@actvero/dsh-capability-ui/client/contracts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { checklistDocument } from '../document.ts'
import styles from './checklist.module.css'

/** Show workbench identity and saved progress without another title row in the business content.
 * @param props Native resource hooks, localized labels.
 * @returns Author-rendered title and progress.
 */
export function Header({ title, workbench, useResource, t }: WorkbenchHeaderProps & PropsLocale<'actvero.template.ai-checklist'>) {
  const resource = useResource<'actvero-workbench'>(workbench.resourceAddress ?? '')
  const state = resource.value ? checklistDocument.parse(JSON.parse(resource.value.json)) : null
  return <div className={styles.header}>
    <h1>{title}</h1>
    <span role={resource.status === 'failed' ? 'alert' : 'status'}>
      {resource.status === 'failed' ? t('readFailed') : state
        ? `${t('section')} ${state.items.filter(item => item.completed).length} / ${state.items.length}` : t('loading')}
    </span>
  </div>
}
