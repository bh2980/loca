import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "../lib/utils"
import { STYLE } from "../primitives/style"
import { useControlId } from "./control-id"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "sm",
  width,
  fixed,
  bare,
  children,
  id,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "xs" | "sm" | "default"
  /** A set width (token name); without it the trigger is as wide as its value. */
  width?: keyof typeof STYLE.width
  /** Keeps its width when the row is short of room. */
  fixed?: boolean
  /** No border or fill: the value reads as text (a trigger in a footer). */
  bare?: boolean
}) {
  return (
    <SelectPrimitive.Trigger
      id={useControlId(id)}
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit min-w-0 max-w-full items-center justify-between gap-1.5 rounded-md border border-default bg-page px-2.5 py-1 text-xs whitespace-nowrap shadow-xs transition-colors",
        "outline-none hover:bg-sunken focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
        "data-[size=xs]:h-6 data-[size=xs]:px-2 data-[size=xs]:text-2xs",
        "data-[size=sm]:h-7 data-[size=sm]:px-2.5 data-[size=sm]:text-xs",
        "data-[size=default]:h-8 data-[size=default]:px-3 data-[size=default]:text-sm",
        "*:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:overflow-hidden *:data-[slot=select-value]:text-ellipsis *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_[data-slot=select-value]>span]:min-w-0 [&_[data-slot=select-value]>span]:truncate",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted",
        bare && "border-0 bg-transparent px-1.5 shadow-none",
        width && STYLE.width[width],
        fixed && "shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        sideOffset={sideOffset}
        position={position}
        className={cn(
          "relative z-50 max-h-[var(--radix-select-content-available-height)] max-w-[var(--radix-popper-available-width)] min-w-[8rem] overflow-hidden rounded-md border border-default bg-overlay text-default shadow-md backdrop-blur-xs",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1 [&_[data-radix-select-item-text]]:min-w-0 [&_[data-radix-select-item-text]]:break-words",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  description,
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label> & { description?: React.ReactNode }) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("flex flex-col items-start gap-0.5 px-2 py-1.5 text-xs font-semibold text-default", className)}
      {...props}
    >
      <span>{children}</span>
      {description != null && <span className="font-normal text-muted">{description}</span>}
    </SelectPrimitive.Label>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-xs py-1 pr-7 pl-2 text-xs outline-none transition-colors",
        "focus:bg-hover focus:text-default data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-1.5 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-line/70", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted",
        className
      )}
      {...props}
    >
      <ChevronUp className="size-3.5" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted",
        className
      )}
      {...props}
    >
      <ChevronDown className="size-3.5" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
