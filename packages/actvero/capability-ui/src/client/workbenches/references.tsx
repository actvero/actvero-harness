/** Native composer codec and historical snapshot presentation, retained after provider removal. */
import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { Modal, ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import { decodeWorkbenchReference, findWorkbenchReference, workbenchReferenceSource, type WorkbenchReferenceSnapshot } from '../../workbench-reference.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap { 'actvero.workbench.reference': WorkbenchReferenceSnapshot }
}

/** Build the codec independent of business-provider lifetimes.
 * @param invalid Localized message for unsupported or damaged persisted references.
 * @returns Native trigger source; candidates are supplied explicitly by business views.
 */
export function createWorkbenchReferenceSource(invalid: () => string): InputTriggerSource { return {
  trigger: '@', name: workbenchReferenceSource, showGroupTitle: false,
  candidates: () => Promise.resolve([]),
  onPick: () => undefined,
  codec: {
    clipboardText: ref => ref,
    serialize(ref, signal) {
      signal.throwIfAborted()
      if (!decodeWorkbenchReference(ref)) return Promise.reject(new RemoteError('workbench/reference', invalid(), { status: 'invalid' }))
      return Promise.resolve(ref)
    },
  },
} }

/** Render only supported envelopes; unknown generations remain readable plain text. */
export const workbenchReferenceRule: UserTextRule<'actvero.workbench.reference'> = {
  id: 'actvero.workbench.reference', order: 10,
  match(text, from) {
    const reference = findWorkbenchReference(text, from)
    return reference ? { id: 'actvero.workbench.reference', ...reference } : undefined
  },
}

function Reference({ node, interactive, t }: UserTextNodeProps<'actvero.workbench.reference'> & PropsLocale<'actvero.workbenches'>) {
  const [opened, setOpened] = useState(false)
  const snapshot = node.data
  return <>
    <ReferenceChip appearance="file" label={snapshot.label} title={t('referenceSnapshot')}
      {...interactive ? { onActivate: () => { setOpened(true) } } : {}} />
    {opened && <Modal open onClose={() => { setOpened(false) }} title={snapshot.label} closeLabel={t('close')}
      description={t('referenceSnapshot')}>
      <p>{t('referenceRevision')}: {snapshot.revision}</p>
      <UserTextRun text={snapshot.content} />
    </Modal>}
  </>
}

/** Register platform-owned reference reading separately from business plugin lifetimes.
 * @param ctx Workbench host Client scope with native input and user-text services.
 */
export function registerWorkbenchReferences(ctx: Context): void {
  const t = ctx.locale.bind('actvero.workbenches')
  ctx.effect(() => ctx.inputTriggers.registerSource(createWorkbenchReferenceSource(() => t('referenceInvalid'))))
  ctx.uiConversation.userText.register(workbenchReferenceRule)
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'actvero.workbench.reference', locale: 'actvero.workbenches',
  }, Reference))
}
