import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { PanelLeftIcon } from "lucide-react"
import { Slot } from "@radix-ui/react-slot"

import { useIsMobile } from "../../lib/use-mobile"
import { Button } from "../../controls/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../controls/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../controls/tooltip"

/* The project screen's sidebar (shadcn/ui sidebar). Its parts take no className: the app's own shapes are props. */

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "13rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  style,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "className"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
            // exactly the window tall; nothing scrolls outside the panes
            "h-svh overflow-hidden"
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "className"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className="flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar"
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l"
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-default group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "className">) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">메뉴 접기·펴기</span>
    </Button>
  )
}

function SidebarRail(props: Omit<React.ComponentProps<"button">, "className">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-line sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2"
      )}
      {...props}
    />
  )
}

// A div, not <main>: the app puts its one <main> around the page itself (inside, below the top bar).
function SidebarInset(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-page",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-lg md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        // beside the sidebar it may shrink and clips its panes
        "min-w-0 overflow-hidden"
      )}
      {...props}
    />
  )
}

function SidebarHeader(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className="flex flex-col gap-2 p-2"
      {...props}
    />
  )
}

/** Project identity used at the top of app navigation. */
function SidebarBrand({ mark, compactMark, title, detail, end, ...props }: Omit<React.ComponentProps<typeof SidebarMenuButton>, "className"> & {
  mark?: React.ReactNode
  compactMark?: React.ReactNode
  title: React.ReactNode
  detail?: React.ReactNode
  end?: React.ReactNode
}) {
  return (
    <SidebarMenuButton size="lg" {...props}>
      {mark != null ? (
        <span className="flex h-6 w-[38px] shrink-0 items-center justify-center rounded-sm bg-sidebar-badge text-xs font-semibold tracking-tight text-on-accent group-data-[collapsible=icon]:w-6">
          <span className={compactMark != null ? "group-data-[collapsible=icon]:hidden" : undefined}>{mark}</span>
          {compactMark != null && <span className="hidden group-data-[collapsible=icon]:inline">{compactMark}</span>}
        </span>
      ) : compactMark != null ? (
        <span className="hidden size-6 shrink-0 items-center justify-center rounded-sm bg-sidebar-badge text-xs font-semibold tracking-tight text-on-accent group-data-[collapsible=icon]:flex">
          {compactMark}
        </span>
      ) : null}
      <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-semibold">{title}</span>
        {detail != null && <span className="truncate text-xs text-muted">{detail}</span>}
      </span>
      {end != null && <span className="group-data-[collapsible=icon]:hidden">{end}</span>}
    </SidebarMenuButton>
  )
}

function SidebarFooter(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className="flex flex-col gap-2 p-2"
      {...props}
    />
  )
}

function SidebarContent(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden"
      {...props}
    />
  )
}

const GROUP_INSET = { tight: "py-1", none: "p-0", condensed: "py-2" } as const

/** A group of the sidebar; `inset` is its vertical padding by name (the default keeps the 8px all round). */
function SidebarGroup({ inset, ...props }: Omit<React.ComponentProps<"div">, "className"> & { inset?: keyof typeof GROUP_INSET }) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", inset && GROUP_INSET[inset])}
      {...props}
    />
  )
}

/** A group's heading in the quiet color. */
function SidebarGroupLabel({
  asChild = false,
  icon,
  ...props
}: Omit<React.ComponentProps<"div">, "className"> & { asChild?: boolean; icon?: React.ReactNode }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar/70 ring-focus outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        "text-subtle"
      )}
      {...props}
    >
      {asChild ? props.children : <>{icon != null && <span className="mr-2 flex shrink-0 [&_svg]:size-4">{icon}</span>}<span className="truncate">{props.children}</span></>}
    </Comp>
  )
}

function SidebarMenu(props: Omit<React.ComponentProps<"ul">, "className">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className="flex w-full min-w-0 flex-col gap-1"
      {...props}
    />
  )
}

function SidebarMenuItem(props: Omit<React.ComponentProps<"li">, "className">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className="group/menu-item relative"
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-focus outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-item hover:text-sidebar focus-visible:ring-2 active:bg-sidebar-item active:text-sidebar disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-item data-[active=true]:font-semibold data-[active=true]:text-sidebar data-[state=open]:hover:bg-sidebar-item data-[state=open]:hover:text-sidebar [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>[data-sidebar=menu-icon]]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-item hover:text-sidebar",
        outline:
          "bg-page shadow-[0_0_0_1px_var(--border-color-default)] hover:bg-sidebar-item hover:text-sidebar hover:shadow-[0_0_0_1px_var(--background-color-sidebar-item)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  activeWeight,
  ...props
}: Omit<React.ComponentProps<"button">, "className"> & {
  asChild?: boolean
  isActive?: boolean
  /** `medium`: the current one is set in medium weight instead of semibold. */
  activeWeight?: "medium"
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), isActive && activeWeight === "medium" && "data-[active=true]:font-medium")}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

/** A screen's icon; `collapsedOnly` shows it only while the sidebar is collapsed to icons. */
function SidebarMenuIcon({ collapsedOnly, ...props }: Omit<React.ComponentProps<"span">, "className"> & { collapsedOnly?: boolean }) {
  return <span data-sidebar="menu-icon" aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center [&>svg]:size-4", collapsedOnly && "hidden group-data-[collapsible=icon]:flex")} {...props} />
}

const MENU_LABEL = {
  plain: "truncate",
  /** Leaves room for the icon that sits over it (and closes up when collapsed). */
  indented: "ml-6 truncate group-data-[collapsible=icon]:ml-0",
  /** Goes away when the sidebar collapses to icons. */
  vanishing: "group-data-[collapsible=icon]:hidden",
} as const

/** A screen's name in the sidebar. */
function SidebarMenuLabel({ placement = "plain", ...props }: Omit<React.ComponentProps<"span">, "className"> & { placement?: keyof typeof MENU_LABEL }) {
  return <span className={MENU_LABEL[placement]} {...props} />
}

function SidebarMenuBadge(props: Omit<React.ComponentProps<"div">, "className">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar peer-data-[active=true]/menu-button:text-sidebar",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden"
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarBrand,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuLabel,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
}
