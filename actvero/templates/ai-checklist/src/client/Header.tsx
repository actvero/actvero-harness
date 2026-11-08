/** The native header observes the same authoritative resource as the business view. */
import type { WorkbenchHeaderProps } from '@actvero/dsh-capability-ui/client/contracts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { checklistDocument } from '../document.ts'

/** Show workbench identity and saved progress without another title row in the business content.
 * @param props Native resource hooks, toolbar factory and localized labels.
 * @returns Host-rendered toolbar.
 */
export function Header({ title, workbench, useResource, renderFactorySlot, t }: WorkbenchHeaderProps & PropsLocale<'actvero.template.ai-checklist'>) {
  const resource = useResource<'actvero-workbench'>(workbench.resourceAddress ?? '')
  const state = resource.value ? checklistDocument.parse(JSON.parse(resource.value.json)) : null
  return renderFactorySlot('actvero.workbench.toolbar', { title,
    status: resource.status === 'failed' ? { text: t('readFailed'), tone: 'error' }
      : { text: state ? `${t('section')} ${state.items.filter(item => item.completed).length} / ${state.items.length}` : t('loading') },
  })
}
