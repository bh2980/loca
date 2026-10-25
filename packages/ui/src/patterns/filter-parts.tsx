import { Check, ListFilter } from "lucide-react"
import type * as React from "react"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { Button, type ButtonProps } from "../controls/button"

/** The tick in front of a filter row: seen when `on`, kept as empty room otherwise so labels line up. */
export function FilterCheck({ on, ...props }: Omit<React.SVGProps<SVGSVGElement>, "ref" | "className"> & { on: boolean }) {
  return <Check className={cn("size-3.5", on ? "opacity-100" : "opacity-0")} {...props} />
}

/**
 * A column header that opens a filter menu: the label and a funnel, tinted when a filter is `active`. It is the trigger of a popover
 * (`PopoverTrigger asChild`), so it passes every prop and the ref on to its button.
 */
export function FilterHeaderButton({ label, active, ...props }: Omit<ButtonProps, "children" | "variant" | "size" | "className"> & { label: ReactNode; active: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <Button variant="ghost" size="inline" className={cn("-mx-1 text-muted", active && "text-accent")} {...props}>
      {label}
      <ListFilter className={active ? "opacity-100" : "opacity-40"} />
    </Button>
  )
}
