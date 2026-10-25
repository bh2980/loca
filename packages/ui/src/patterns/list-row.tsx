import { Slot } from "@radix-ui/react-slot"
import type { ComponentProps, ReactNode } from "react"
import { Button, type ButtonProps } from "../controls/button"
import { DropdownMenuItem } from "../controls/dropdown-menu"
import { cn } from "../lib/utils"

type ItemRow = Omit<ComponentProps<"li">, "className"> & {
  as?: "li"
  /** `plain`: a row of an inspector list (the first and last sit flush); `choice`: a row that is picked (`selected` marks the open one; `flagged` a match). */
  variant?: "plain" | "choice"
  /** `plain` only: `tight` 4px above and below; `loose` 8px and body text. */
  density?: "tight" | "loose"
  selected?: boolean
  flagged?: boolean
}

type LinkRow = {
  /** The one child (a router link) becomes the row. */
  as: "link"
  /** `menu`: a row of a popover list; `bordered`: a full row of a bordered list; `line`: a line of a list in a pane, lit under the pointer; `nav`: a link of a navigation list (`active` marks the open one); `nav-section`: the link beside a branch's fold button; `nav-scene`: a two-line link (name above a meter; `complete` quiets it). */
  variant?: "menu" | "bordered" | "line" | "nav" | "nav-section" | "nav-scene"
  /** `nav*` only: the link of the open place. */
  active?: boolean
  /** `nav-scene` only: everything in it is done. */
  complete?: boolean
  /** `line` only: inset from the list's edge. */
  inset?: boolean
  /** `menu` only: `tight` px 6 / py 4; `loose` 6px all round. */
  density?: "tight" | "loose"
  /** `menu` only: the parts one under the other instead of side by side. */
  stacked?: boolean
  /** `menu` only: something needing a look. */
  tone?: "warning"
  /** `bordered` only: body text. */
  size?: "sm"
  children: ReactNode
}

type ButtonRow = Omit<ButtonProps, "variant" | "size" | "className" | "asChild"> & {
  as: "button"
  /** `result`: two lines divided by a hairline (a found item); `pick`: one line in body text. */
  variant?: "result" | "pick"
}

type MenuRow = Omit<ComponentProps<typeof DropdownMenuItem>, "className"> & {
  as: "menuitem"
  /** The current one reads medium. Its own buttons (`group/row`) show on hover or focus. */
  selected?: boolean
  /** The parts one under the other (a found item: its title, then where it matched); no buttons of its own. */
  stacked?: boolean
}

export type ListRowProps = ItemRow | LinkRow | ButtonRow | MenuRow

const MENU_ROW = "rounded text-sm"

function navLink(active: boolean, className?: string) {
  return cn(
    "flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs tracking-tight transition-colors",
    active ? "bg-selected font-semibold text-default ring-1 ring-inset ring-accent/50" : "text-muted hover:bg-hover hover:text-default",
    className,
  )
}

/** One row of a list: an `li`, a link, a button or a menu item, by `as`; `variant` is its look, `selected` the one that is open. */
export function ListRow(props: ListRowProps) {
  if (props.as === "link") {
    const { as: _, variant = "menu", density = "tight", stacked, tone, size, inset, active = false, complete = false, children, ...rest } = props
    const className =
      variant === "nav" || variant === "nav-section" || variant === "nav-scene"
        ? navLink(active, variant === "nav-section" ? "min-w-0 flex-1" : variant === "nav-scene" ? cn("h-auto min-h-7 flex-col items-stretch gap-1 py-1 px-2", !active && "text-default/90", complete && !active && "text-subtle") : undefined)
        : variant === "bordered"
        ? cn("flex items-center gap-4 px-4 py-3 hover:bg-sunken", size === "sm" && "text-sm")
        : variant === "line"
          ? cn("block py-1.5 text-sm hover:bg-sunken", inset && "px-1")
          : cn(
            MENU_ROW,
            stacked ? "block space-y-1" : "flex items-center justify-between",
            density === "tight" ? "px-1.5 py-1" : "p-1.5",
            tone === "warning" ? "text-warning hover:bg-warning/10" : "hover:bg-hover hover:text-default",
          )
    return <Slot className={className} {...rest}>{children}</Slot>
  }
  if (props.as === "button") {
    const { as: _, variant = "result", ...rest } = props
    return variant === "pick" ? (
      <Button variant="ghost" size="row" className="text-sm" {...rest} />
    ) : (
      <Button variant="ghost" className="flex h-auto w-full min-w-0 flex-col items-start rounded-none border-b border-default px-2 py-1.5 text-left text-sm last:border-b-0" {...rest} />
    )
  }
  if (props.as === "menuitem") {
    const { as: _, selected, stacked, ...rest } = props
    return <DropdownMenuItem className={cn(stacked ? "flex-col items-start gap-0" : "group/row pr-1", selected && "font-medium")} {...rest} />
  }
  const { as: _, variant = "plain", density = "tight", selected, flagged, ...rest } = props
  const className =
    variant === "choice"
      ? cn("transition-colors", selected ? "bg-selected" : "cursor-pointer", flagged && !selected && "bg-warning/5")
      : density === "tight"
        ? "py-1 first:pt-0 last:pb-0"
        : "py-2 text-sm first:pt-0 last:pb-0"
  return <li className={className} {...rest} />
}
