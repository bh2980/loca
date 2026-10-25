import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Slot } from "@radix-ui/react-slot"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./dropdown-menu"

interface ContextMenuState {
  open: boolean
  setOpen: (open: boolean) => void
  point: { x: number; y: number }
  openAt: (x: number, y: number) => void
}

const ContextMenuContext = React.createContext<ContextMenuState | null>(null)

function ContextMenu({
  children,
  onOpenChange,
}: {
  children: React.ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = React.useState(false)
  const [point, setPoint] = React.useState({ x: 0, y: 0 })

  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  const openAt = React.useCallback(
    (x: number, y: number) => {
      setPoint({ x, y })
      setOpen(true)
    },
    [setOpen]
  )

  return (
    <ContextMenuContext.Provider value={{ open, setOpen, point, openAt }}>
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
        {open && (
          <DropdownMenuPrimitive.Trigger asChild>
            <span
              aria-hidden
              style={{
                position: "fixed",
                left: point.x,
                top: point.y,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
          </DropdownMenuPrimitive.Trigger>
        )}
        {children}
      </DropdownMenuPrimitive.Root>
    </ContextMenuContext.Provider>
  )
}

function ContextMenuTrigger({
  asChild,
  children,
  disabled,
  onContextMenu,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
  disabled?: boolean
}) {
  const ctx = React.useContext(ContextMenuContext)
  const Comp = asChild ? Slot : "div"
  return (
    <Comp
      data-slot="context-menu-trigger"
      onContextMenu={(event: React.MouseEvent<HTMLDivElement>) => {
        onContextMenu?.(event)
        if (event.defaultPrevented || disabled || !ctx) return
        event.preventDefault()
        event.stopPropagation()
        ctx.openAt(event.clientX, event.clientY)
      }}
      {...props}
    >
      {children}
    </Comp>
  )
}

function ContextMenuContent({
  align = "start",
  side = "bottom",
  sideOffset = 2,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="context-menu-content"
      align={align}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

const ContextMenuGroup = DropdownMenuGroup
const ContextMenuPortal = DropdownMenuPortal
const ContextMenuItem = DropdownMenuItem
const ContextMenuCheckboxItem = DropdownMenuCheckboxItem
const ContextMenuRadioGroup = DropdownMenuRadioGroup
const ContextMenuRadioItem = DropdownMenuRadioItem
const ContextMenuLabel = DropdownMenuLabel
const ContextMenuSeparator = DropdownMenuSeparator
const ContextMenuShortcut = DropdownMenuShortcut
const ContextMenuSub = DropdownMenuSub
const ContextMenuSubContent = DropdownMenuSubContent
const ContextMenuSubTrigger = DropdownMenuSubTrigger

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
