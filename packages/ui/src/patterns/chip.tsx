import type * as React from "react"
import { Button } from "../controls/button"
import { cn } from "../lib/utils"
import { chipStyle } from "./palette"

/** The small pill that solid, quiet and outline chips share. */
const PILL =
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm px-1 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-focus focus-visible:ring-[2px] focus-visible:ring-focus/40 [&>svg]:pointer-events-none [&>svg]:size-3"
const TINT = "inline-flex items-center rounded-sm px-1 py-0.5 text-xs font-medium whitespace-nowrap"
const CARD = "rounded-md border border-default bg-surface px-1 py-0.5 text-xs shadow-2xs"
const FLOAT = "rounded-md border border-default bg-surface text-sm shadow-2xs select-none"

type Tone = "accent" | "danger" | "success" | "warning" | "muted" | "choice"

export type ChipProps = Omit<React.HTMLAttributes<HTMLElement>, "className"> &
  Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "type"> & {
    /** The element: a `span` by default; `button` for a chip that is pressed (`card`, `bare`). */
    as?: "span" | "div" | "p" | "label" | "button"
    /**
     * The look. `solid` / `quiet` / `outline`: a small pill (a count, a state, a label); `plain`: its text only; `tint`: a tag in its own
     * `color`; `field`: one value of a chip field; `card`: a bordered note under a line; `pill`: a rounded outline (`tone="choice"` tints it);
     * `note` / `bar`: a card laid over a canvas (one line of text, or a row of text and buttons); `bare`: a pressable with no chrome of its own.
     */
    variant?: "solid" | "quiet" | "outline" | "plain" | "tint" | "field" | "card" | "pill" | "note" | "bar" | "bare"
    /** Colour by meaning (`solid` takes `danger`; `outline` and `card` take the rest). */
    tone?: Tone
    /** `compact` is 16px tall; `tight` is 16px tall with less padding at the sides. */
    size?: "default" | "compact" | "tight"
    /** An `outline` chip's border at 40% (a hint, not an alarm). */
    soft?: boolean
    /** Faint until hovered (a tag not picked yet). */
    faint?: boolean
    /** Ends in a button (remove, an action), so the end padding is trimmed. */
    removable?: boolean
    /** The colour of a `tint` chip, as stored (a palette colour or hex). */
    color?: string
  }

/** A parent `Box asChild` hands its options over as `className`; it is not part of the public props. */
type FromSlot = { className?: string }

const SIZE = { default: undefined, compact: "h-4", tight: "h-4 px-1" } as const

function variantClass(variant: NonNullable<ChipProps["variant"]>, tone: Tone | undefined, soft: boolean | undefined, removable: boolean | undefined, button: boolean) {
  switch (variant) {
    case "solid":
      return cn(PILL, tone === "danger" ? "bg-danger text-inverse focus-visible:ring-danger/20" : "bg-accent text-on-accent")
    case "quiet":
      return cn(PILL, "bg-quiet text-default")
    case "outline":
      return cn(
        PILL,
        "border-default text-default",
        tone === "muted" && "text-muted",
        tone === "success" && (soft ? "border-success/40 text-success" : "border-success text-success"),
        tone === "warning" && (soft ? "border-warning/40 text-warning" : "border-warning text-warning"),
      )
    case "plain":
      return cn(PILL, "h-auto border-0 bg-transparent px-0 font-normal text-muted")
    case "tint":
      return TINT
    case "field":
      return cn("inline-flex items-center rounded bg-sunken py-0.5 text-xs", removable ? "gap-0.5 pr-0.5 pl-2" : "px-2")
    case "card":
      return cn(button ? "h-auto gap-1" : "inline-flex items-center gap-1", CARD, button && "font-normal hover:bg-hover", tone === "warning" && "border-warning/40 text-warning")
    case "pill":
      return cn("rounded-full border px-1", tone === "choice" ? "border-graph-choice/30 bg-graph-choice/10 text-graph-choice" : "bg-page")
    case "note":
      return cn(FLOAT, "max-w-3xl px-2 py-1 text-muted")
    case "bar":
      return cn(FLOAT, "flex max-w-full flex-wrap items-center gap-2 py-1 backdrop-blur-xs", removable ? "pr-1 pl-2" : "px-2", tone === "muted" && "text-muted")
    case "bare":
      return "h-auto p-0 hover:bg-transparent"
  }
}

/**
 * A small labelled mark: a count or state pill, a tag in its colour, a value in a chip field, a note under a line, a card over a canvas.
 * `variant` is the look, `tone` the meaning, `size` the height; `Chip.Dot` is the accent dot before its text.
 */
export function Chip(allProps: ChipProps) {
  const { as: Tag = "span", variant = "solid", tone, size = "default", soft, faint, removable, color, className, style, ...props } = allProps as ChipProps & FromSlot
  const button = Tag === "button"
  const classes = cn(
    variantClass(variant, tone, soft, removable, button),
    variant !== "bare" && variant !== "plain" && SIZE[size],
    faint && "opacity-50 hover:opacity-100",
    className,
  )
  if (button) return <Button variant="ghost" size="inline" className={classes} style={style} {...props} />
  return <Tag data-slot="chip" className={classes} style={variant === "tint" ? { ...chipStyle(color ?? ""), ...style } : style} {...(props as React.HTMLAttributes<HTMLElement>)} />
}

/** A small dot before a chip's text, in the accent (a mark that something is highlighted). */
Chip.Dot = function ChipDot() {
  return <span className="size-1.5 rounded-full bg-accent" />
}
