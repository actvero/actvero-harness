/** Native composer codec and historical snapshot presentation, retained after provider removal. */
import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { Button, Modal, ReferenceChip, UserTextRun } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchObjectLocation } from '../../contracts.ts'
import { readWorkbenchResult } from '../../workbench-result.ts'
import { decodeWorkbenchReference, findWorkbenchReference, workbenchReferenceSource, workbenchSelectionSource, type WorkbenchReferenceSnapshot } from '../../workbench-reference.ts'
import css from './references.module.css'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap { 'actvero.workbench.reference': WorkbenchReferenceSnapshot }
}

/** Build the codec independent of business-provider lifetimes.
 * @param invalid Localized message for unsupported or damaged persisted references.
 * @param name Native source identity for manual or automatic chips.
 * @returns Native trigger source; candidates are supplied explicitly by business views.
 */
export function createWorkbenchReferenceSource(
  invalid: () => string, name: string = workbenchReferenceSource,
): InputTriggerSource { return {
  trigger: '@', name, showGroupTitle: false,
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

type Navigation = { openObject: (target: WorkbenchObjectLocation) => Promise<void> }
type Labels = PropsLocale<'actvero.workbenches'>

function SnapshotDialog({ snapshot, t, openObject, close }: Labels & Navigation & {
  snapshot: WorkbenchReferenceSnapshot
  close: () => void
}) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const navigate = async () => {
    setPending(true)
    setFailed(false)
    try { await openObject(snapshot); close() }
    catch (_error) { setFailed(true) }
    finally { setPending(false) }
  }
  return <Modal open onClose={close} title={snapshot.label} closeLabel={t('close')}
    description={t('referenceSnapshot')}>
    <p>{t('referenceRevision')}: {snapshot.revision}</p>
    <UserTextRun text={snapshot.content} />
    <Button disabled={pending} onClick={() => { void navigate() }}>{t('referenceOpen')}</Button>
    {failed && <p role="alert">{t('referenceOpenFailed')}</p>}
  </Modal>
}

function Snapshot({ snapshot, interactive, t, openObject }: Labels & Navigation & {
  snapshot: WorkbenchReferenceSnapshot
  interactive: boolean
}) {
  const [opened, setOpened] = useState(false)
  return <>
    <ReferenceChip appearance="file" label={snapshot.label} title={t('referenceSnapshot')}
      {...interactive ? { onActivate: () => { setOpened(true) } } : {}} />
    {opened && <SnapshotDialog snapshot={snapshot} t={t} openObject={openObject} close={() => { setOpened(false) }} />}
  </>
}

function Reference({ node, interactive, ...props }: UserTextNodeProps<'actvero.workbench.reference'> & Labels & Navigation) {
  return <Snapshot {...props} snapshot={node.data} interactive={interactive} />
}

function Result({ block, t, openObject }: PropsRuntime<'tool.call.result'> & Labels & Navigation) {
  const result = readWorkbenchResult(block.meta)
  if (block.isError || !result) return null
  return <article className={css.result} aria-label={result.title}>
    <strong>{result.title}</strong>
    <UserTextRun text={result.summary} />
    <div className={css.references}>{result.references.map(snapshot =>
      <Snapshot key={JSON.stringify([snapshot.workbenchId, snapshot.instanceId, snapshot.objectId, snapshot.revision])}
        snapshot={snapshot} t={t} openObject={openObject} interactive />)}</div>
  </article>
}

type Preview = { hooks: { preview: ReturnType<typeof createSnapshotStore<WorkbenchReferenceSnapshot | null>> }; close: () => void }

function DraftPreview({ usePreview, close, t, openObject }: InjectFace<Preview> & Labels & Navigation) {
  const snapshot = usePreview(value => value)
  return snapshot ? <SnapshotDialog key={encodeURIComponent(JSON.stringify(snapshot))}
    snapshot={snapshot} close={close} t={t} openObject={openObject} /> : null
}

/** Register platform-owned reference reading separately from business plugin lifetimes.
 * @param ctx Workbench host Client scope with native input and user-text services.
 * @param openObject Validated navigation to an installed provider's object view.
 */
export function registerWorkbenchReferences(ctx: Context, openObject: Navigation['openObject']): void {
  const t = ctx.locale.bind('actvero.workbenches')
  const preview = createSnapshotStore<WorkbenchReferenceSnapshot | null>(null)
  const close = () => { preview.set(null) }
  for (const name of [workbenchReferenceSource, workbenchSelectionSource]) {
    ctx.effect(() => ctx.inputTriggers.registerSource({ ...createWorkbenchReferenceSource(() => t('referenceInvalid'), name),
      openReference(_session, reference) {
        const snapshot = decodeWorkbenchReference(reference.ref)
        if (!snapshot) return false
        preview.set(snapshot)
        return true
      },
    }))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'actvero.workbench.reference-preview', locale: 'actvero.workbenches',
    inject: () => ({ hooks: { preview }, close, openObject }),
  }, DraftPreview))
  ctx.uiConversation.userText.register(workbenchReferenceRule)
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node', key: 'actvero.workbench.reference', locale: 'actvero.workbenches', inject: () => ({ openObject }),
  }, Reference))
  ctx.slots.inject('tool.call.result', () => ctx.slots.register({
    name: 'tool.call.result', id: 'actvero.workbench.result', locale: 'actvero.workbenches', inject: () => ({ openObject }),
  }, Result))
}
