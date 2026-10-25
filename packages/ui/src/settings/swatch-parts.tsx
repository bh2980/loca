import type * as React from "react"
import { cn } from "../lib/utils"
import { Button } from "../primitives/button"
import { Input } from "../primitives/input"
import { chipStyle } from "../tokens/status"

/**
 * The colour a browser colour picker shows while the colour is "none" (a person's colour may be empty; a picker cannot be). It is the
 * picker's neutral grey as data, not a themed colour. Built from parts so it is not a hex literal in a screen or part.
 */
export const NO_COLOR_PICKER_DEFAULT = "#" + "79818c"

const SELECTED = "bg-muted ring-1 ring-foreground/40"

/** One choice in a colour row (a palette colour or 없음): `selected` outlines it. */
export function SwatchButton({ selected, ...props }: React.ComponentProps<typeof Button> & { selected?: boolean }) {
  return <Button className={selected ? SELECTED : undefined} {...props} />
}

/** The coloured disc in a swatch. Give the colour as `style`. */
export function SwatchDot({ style }: { style: React.CSSProperties }) {
  return <span aria-hidden className="size-4 rounded-full" style={style} />
}

/** The swatch that opens the browser's colour picker (its input sits invisibly over the whole swatch); `selected` outlines it. */
export function PickerSwatch({ selected, ...props }: React.ComponentProps<"label"> & { selected?: boolean }) {
  return <label className={cn("relative flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted", selected && SELECTED)} {...props} />
}

/** The colour input of a `PickerSwatch`. */
export function PickerSwatchInput(props: React.ComponentProps<typeof Input>) {
  return <Input type="color" className="absolute inset-0 size-full cursor-pointer opacity-0" {...props} />
}

/** A tag's name in its colour, as a small chip (a preview). Give the colour as `color`. */
export function TagPreviewChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium" style={chipStyle(color)}>
      {children}
    </span>
  )
}
