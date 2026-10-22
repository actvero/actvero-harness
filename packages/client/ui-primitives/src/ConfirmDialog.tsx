import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'
import css from './ConfirmDialog.module.css'

/** Localized ordinary confirmation, separate from high-risk acknowledgement flows. */
export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  resourceName: string
  closeLabel: string
  cancelLabel: string
  confirmLabel: string
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Keep the reviewed target visible and block duplicate submissions while pending. */
export function ConfirmDialog({ open, title, description, resourceName, closeLabel, cancelLabel, confirmLabel,
  pending = false, onCancel, onConfirm }: ConfirmDialogProps) {
  return <Modal open={open} title={title} closeLabel={closeLabel} description={description}
    onClose={() => { if (!pending) onCancel() }}
    footer={<>
      <Button data-modal-autofocus disabled={pending} onClick={onCancel}>{cancelLabel}</Button>
      <Button className={css.danger} disabled={pending} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
    <p className={css.target}>{resourceName}</p>
  </Modal>
}
