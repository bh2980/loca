import { Slot } from "@radix-ui/react-slot"
import { cn } from "../lib/utils"
import type * as React from "react"

const TONE = { inherit: "", muted: "text-muted" } as const
const UNDERLINE = { always: "underline", offset: "underline underline-offset-2", hover: "hover:underline" } as const

export type TextLinkProps = Omit<React.ComponentProps<"a">, "ref"> & {
  /** Puts the look on the one child (a router link) instead of rendering an `<a>`. */
  asChild?: boolean
  /** The color before hover: the text around it (default) or `muted`. */
  tone?: keyof typeof TONE
  /** Turns the text to the default color under the pointer. */
  quiet?: boolean
  /** `always`; `offset` (a little below the text); `hover` (only under the pointer). */
  underline?: keyof typeof UNDERLINE
  /** `caption` is the small text size. */
  variant?: "caption"
  weight?: "normal"
  block?: boolean
}

/**
 * A link in or beside text. It takes the size and color of the text around it unless named; the link keeps its own element (give a router
 * link as the child with `asChild`). `className` is only for a part that wraps it with `asChild`.
 */
export function TextLink({ asChild, tone = "inherit", quiet, underline, variant, weight, block, className, ...props }: TextLinkProps) {
  const Element = asChild ? Slot : "a"
  return (
    <Element
      className={cn(variant === "caption" && "text-xs", weight === "normal" && "font-normal", block && "block", TONE[tone], underline && UNDERLINE[underline], quiet && "hover:text-default", className)}
      {...props}
    />
  )
}
