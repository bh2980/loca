import * as React from "react"
import { Maximize, Minus, Plus } from "lucide-react"
import { Button } from "../primitives/button"
import { Icon } from "../primitives/icon"
import { cn } from "../lib/utils"

/**
 * Chrome laid over a graph canvas: the small notes above it (`CanvasChip`), the zoom buttons, a status toast and the list of found nodes.
 * They are cards on the canvas's grid, so each is a quiet card with a hairline and a small shadow.
 */

type ChipProps = Omit<React.HTMLAttributes<HTMLElement>, "className"> & {
  /** `note`: one line of text; `actions`: text then buttons (less padding at the end); `toggle`: a switch and its label. */
  kind?: "note" | "actions" | "toggle"
}

const CHIP = {
  note: "max-w-3xl rounded-md border border-border bg-card px-2.5 py-1 text-sm text-muted-foreground shadow-2xs select-none",
  actions: "flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card py-1 pr-1.5 pl-2.5 text-sm shadow-2xs backdrop-blur-xs select-none",
  toggle: "flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-sm text-muted-foreground shadow-2xs backdrop-blur-xs select-none",
} as const

export function CanvasChip({ kind = "note", ...props }: ChipProps) {
  return <div className={CHIP[kind]} {...props} />
}

/** `CanvasChip` as a label (a switch with its words). */
export function CanvasChipLabel(props: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "className">) {
  return <label className={CHIP.toggle} {...props} />
}

/** `CanvasChip` as a paragraph. */
export function CanvasChipNote(props: Omit<React.HTMLAttributes<HTMLParagraphElement>, "className">) {
  return <p className={CHIP.note} {...props} />
}

/** A small dot before a chip's text, in the accent (a mark that something is highlighted). */
export function ChipDot() {
  return <span className="size-1.5 rounded-full bg-primary" />
}

/** Zoom out, zoom in, fit: a bar of three buttons at the canvas's lower right. */
export function FloatingZoomBar({ onZoomOut, onZoomIn, onFit }: { onZoomOut: () => void; onZoomIn: () => void; onFit: () => void }) {
  const button = "rounded-none hover:bg-accent text-muted-foreground hover:text-foreground"
  return (
    <div className="absolute right-3 bottom-3 flex items-center rounded-lg border border-border bg-card shadow-xs backdrop-blur-md overflow-hidden select-none">
      <Button variant="ghost" size="icon-sm" aria-label="축소" onClick={onZoomOut} className={button}>
        <Icon icon={Minus} size="sm" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="확대" onClick={onZoomIn} className={button}>
        <Icon icon={Plus} size="sm" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="전체 맞춤" onClick={onFit} className={button}>
        <Icon icon={Maximize} size="sm" />
      </Button>
    </div>
  )
}

/** A status line that floats at the top middle of the canvas and never takes a click. */
export function CanvasToast(props: Omit<React.HTMLAttributes<HTMLDivElement>, "className">) {
  return <div className="pointer-events-none absolute top-14 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-sm" {...props} />
}

/** The list of nodes found by the canvas's search box, dropping down under it. */
export function FoundNodeList(props: Omit<React.HTMLAttributes<HTMLUListElement>, "className">) {
  return <ul className={cn("absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover/95 p-1 text-sm shadow-md backdrop-blur-md")} {...props} />
}
