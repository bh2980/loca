import { FileUp } from "lucide-react"
import type * as React from "react"
import { cn } from "../../lib/utils"

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
      className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-default px-4 py-8 text-sm text-muted hover:bg-sunken transition-colors", dragging && "border-accent bg-sunken text-default")}
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
