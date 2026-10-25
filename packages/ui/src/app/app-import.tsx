import { FileUp } from "lucide-react"
import type * as React from "react"
import { cn } from "../lib/utils"
import { DialogContent } from "../primitives/dialog"
import { FieldRows } from "../primitives/heading"

/** The import dialog's content: a little wider than a plain dialog. */
export function ImportDialogContent(props: Omit<React.ComponentProps<typeof DialogContent>, "className">) {
  return <DialogContent className="sm:max-w-lg" {...props} />
}

/**
 * Click to pick a file, or drop one on it. `children` is the text inside (what it says, or the file's name); `dragging` is whether a file is over
 * it and `onDraggingChange` tells the screen when that changes.
 */
export function FileDropZone({ accept, dragging, onDraggingChange, onFile, children }: {
  accept: string
  dragging: boolean
  onDraggingChange: (dragging: boolean) => void
  onFile: (file: File | undefined) => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground hover:bg-muted transition-colors", dragging && "border-primary bg-muted text-foreground")}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        onDraggingChange(true)
      }}
      onDragLeave={() => onDraggingChange(false)}
      onDrop={(event) => {
        event.preventDefault()
        onDraggingChange(false)
        onFile(event.dataTransfer.files[0])
      }}
    >
      <FileUp className="size-5" />
      {children}
      <input type="file" accept={accept} className="sr-only" onChange={(event) => onFile(event.currentTarget.files?.[0])} />
    </label>
  )
}

/** The rows summarizing what a file contains, in a hairline frame. */
export function ImportSummaryRows(props: Omit<React.ComponentProps<typeof FieldRows>, "className">) {
  return <FieldRows className="rounded-md border p-3" {...props} />
}
