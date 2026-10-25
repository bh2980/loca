import type { ComponentProps } from "react"
import { DropdownMenuLabel } from "../controls/dropdown-menu"

const TONE = {
  /** The menu's own small caps label in the muted color. */
  muted: "text-muted",
  /** A heading of the menu: strong weight, foreground color. */
  strong: "text-xs font-semibold text-default",
  /** The quiet heading of a group inside a menu: normal weight, muted. */
  quiet: "text-xs font-normal text-muted",
} as const

/** The label of a group of menu items; `tone` says how loud it is (muted, strong, quiet). */
export function MenuLabel({ tone = "muted", ...props }: Omit<ComponentProps<typeof DropdownMenuLabel>, "className"> & { tone?: keyof typeof TONE }) {
  return <DropdownMenuLabel className={TONE[tone]} {...props} />
}
