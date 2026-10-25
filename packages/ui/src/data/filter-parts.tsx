import { Check, ListFilter } from "lucide-react"
import type * as React from "react"
import type { ReactNode } from "react"
import { SegmentedControl } from "../layout/segmented-control"
import { cn } from "../lib/utils"
import { Button, type ButtonProps } from "../primitives/button"
import { PopoverContent } from "../primitives/popover"

/** The tick in front of a filter row: seen when `on`, kept as empty room otherwise so labels line up. */
export function FilterCheck({ on, ...props }: Omit<React.SVGProps<SVGSVGElement>, "ref"> & { on: boolean }) {
  return <Check className={cn("size-3.5", on ? "opacity-100" : "opacity-0")} {...props} />
}

/**
 * A column header that opens a filter menu: the label and a funnel, tinted when a filter is `active`. It is the trigger of a popover
 * (`PopoverTrigger asChild`), so it passes every prop and the ref on to its button.
 */
export function FilterHeaderButton({ label, active, ...props }: Omit<ButtonProps, "children" | "variant" | "size" | "className"> & { label: ReactNode; active: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <Button variant="ghost" size="inline" className={cn("-mx-1 text-muted-foreground", active && "text-primary")} {...props}>
      {label}
      <ListFilter className={active ? "opacity-100" : "opacity-40"} />
    </Button>
  )
}

/** The popover under a filter header: 16rem wide, no padding of its own (the command list pads its rows). */
export function FilterPopoverContent(props: React.ComponentProps<typeof PopoverContent>) {
  return <PopoverContent align="start" className="w-64 p-0" {...props} />
}

/** A segmented control that fills the width of its menu, every segment equally wide (the show / hide switch of a filter menu). */
export function FilterSegmentedBar(props: Omit<React.ComponentProps<typeof SegmentedControl>, "className">) {
  return <SegmentedControl className="flex w-full [&>*]:flex-1" {...props} />
}
