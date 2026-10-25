import { clsx } from "clsx"
import type { LucideIcon } from "lucide-react"
import type * as React from "react"
import { type StyleProps, splitStyle, styleVariants } from "./style"

export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "ref" | "size" | keyof StyleProps> & Pick<StyleProps, "tone" | "display" | "shrink" | "marginLeft" | "marginRight" | "marginTop" | "opacity"> & {
  icon: LucideIcon
  /** xs 12px (size-3), sm 14px (size-3.5), md 16px (size-4). With none the icon takes the size of the control around it. */
  size?: "xs" | "sm" | "md"
  /** For a chevron that turns when its section opens: `true` is turned, `false` is not yet; `"group"` follows the `data-state` of a `group` parent. */
  turn?: boolean | "group"
}

const SIZE = { xs: "size-3", sm: "size-3.5", md: "size-4" } as const

/** A lucide icon with its size, color and turning by name. It renders the svg itself, no wrapper. */
export function Icon({ icon: Glyph, size, turn, className, ...props }: IconProps) {
  const [style, rest] = splitStyle(props)
  const turning = turn === undefined ? "" : turn === "group" ? "transition-transform group-data-[state=open]:rotate-90" : turn ? "transition-transform rotate-90" : "transition-transform"
  return <Glyph className={clsx(size && SIZE[size], styleVariants(style), turning, className) || undefined} {...rest} />
}
