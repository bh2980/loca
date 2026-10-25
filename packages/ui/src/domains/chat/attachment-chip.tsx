import { X } from "lucide-react"
import { Button } from "../../controls/button"

/**
 * What a message points at: the kind and a short name. With `onOpen` the chip is a button that opens the item; with `onRemove` it can be
 * taken out (the box, before sending).
 */
export function AttachmentChip({ kind, label, title, onOpen, openLabel, onRemove, removeLabel }: {
  kind: string
  label: string
  /** The full name, as a tooltip. */
  title: string
  onOpen?: () => void
  openLabel?: string
  onRemove?: () => void
  removeLabel?: string
}) {
  const body = (
    <>
      <span className="text-muted">{kind}</span>
      <span className="truncate">{label}</span>
    </>
  )
  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-sunken text-xs">
      {onOpen ? (
        <Button type="button" variant="ghost" size="inline" className="min-w-0 hover:bg-transparent" title={title} aria-label={openLabel} onClick={onOpen}>
          {body}
        </Button>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1 px-1 py-0.5" title={title}>{body}</span>
      )}
      {onRemove && (
        <Button type="button" variant="ghost" size="inline" aria-label={removeLabel} className="p-0.5 text-muted hover:bg-transparent hover:text-default" onClick={onRemove}>
          <X />
        </Button>
      )}
    </span>
  )
}
