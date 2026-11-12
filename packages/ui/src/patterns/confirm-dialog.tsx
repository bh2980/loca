import { useRef, type ReactNode } from "react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../controls/alert-dialog"
import { Button } from "../controls/button"

export interface ConfirmDialogProps {
  /** The button that opens it. Without one the dialog is controlled by `open`. */
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  /** What the confirmation needs besides its sentence: a field to type in, a choice, the list of effects. */
  children?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** The write is on its way: the confirm button waits. */
  pending?: boolean
  /** The confirmation is not answerable yet (a name not typed, a count not loaded). */
  disabled?: boolean
  /**
   * The confirm button does not close the dialog; the caller closes it when the write is done. For a dialog that
   * holds input the write needs, so a failed write leaves it as it was.
   */
  keepOpen?: boolean
  onConfirm: () => void
}

/**
 * The one confirmation before something is destroyed or cannot be taken back: a sentence that asks, a sentence
 * that says what is lost, cancel and a danger button. Wording belongs to the caller.
 */
export function ConfirmDialog({ trigger, open, onOpenChange, title, description, children, confirmLabel = "삭제", cancelLabel = "취소", pending = false, disabled = false, keepOpen = false, onConfirm }: ConfirmDialogProps) {
  // A controlled dialog is usually open while its subject is set, and the subject is gone the moment it closes:
  // the wording of the last open render stays while the dialog fades out.
  const live = { title, description, children, confirmLabel }
  const last = useRef(live)
  if (open !== false) last.current = live
  const shown = open === false ? last.current : live
  const blocked = pending || disabled
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {shown.children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          {keepOpen
            ? <Button variant="destructive" disabled={blocked} aria-busy={pending || undefined} onClick={onConfirm}>{shown.confirmLabel}</Button>
            : <AlertDialogAction disabled={blocked} onClick={onConfirm}>{shown.confirmLabel}</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
