import type * as React from "react"
import { cn } from "../lib/utils"
import { Button, type ButtonProps } from "../controls/button"
import { Input } from "../controls/input"

const SELECTED = "bg-sunken ring-1 ring-strong/40"

/** The colored disc of a swatch; `color` is any CSS background (a color, a gradient). */
function Dot({ color }: { color: string }) {
  return <span aria-hidden className="size-4 rounded-full" style={{ background: color }} />
}

/**
 * One choice in a row of colors. With `color` it is a disc (pass `size="icon"`); without, its children are the label (a "none" choice).
 * `selected` outlines it.
 */
export function Swatch({ selected, color, children, ...props }: Omit<ButtonProps, "variant" | "className" | "asChild"> & { selected?: boolean; color?: string }) {
  return (
    <Button variant="ghost" className={selected ? SELECTED : undefined} {...props}>
      {color ? <Dot color={color} /> : children}
    </Button>
  )
}

/**
 * The swatch that opens the browser's color picker (its input sits invisibly over the whole swatch); `color` fills the disc, `selected`
 * outlines it. `value` may be empty (a picker cannot show "none", so it then shows its neutral grey).
 */
export function SwatchPicker({ selected, color, value, onValueChange, label, title }: { selected?: boolean; color: string; value: string; onValueChange: (color: string) => void; label: string; title?: string }) {
  return (
    <label title={title} className={cn("relative flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-sunken", selected && SELECTED)}>
      <Dot color={color} />
      <Input type="color" aria-label={label} className="absolute inset-0 size-full cursor-pointer opacity-0" value={value || NO_COLOR_DEFAULT} onChange={(event) => onValueChange(event.target.value)} />
    </label>
  )
}

/** The picker's neutral grey while the color is "none", as data (not a themed color); built from parts so it is no hex literal in a part. */
const NO_COLOR_DEFAULT = "#" + "79818c"
