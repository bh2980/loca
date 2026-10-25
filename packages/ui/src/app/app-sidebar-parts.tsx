import { ChevronsUpDown } from "lucide-react"
import type * as React from "react"
import { cn } from "../lib/utils"
import { SidebarGroup, SidebarGroupLabel, SidebarMenuButton, SidebarMenuIcon } from "../layout/sidebar"
import { DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioItem } from "../primitives/dropdown-menu"

/** A screen's button in the sidebar; the current one is set in medium weight. */
export function ScreenMenuButton({ isActive, className, ...props }: React.ComponentProps<typeof SidebarMenuButton>) {
  return <SidebarMenuButton isActive={isActive} className={cn(isActive && "data-[active=true]:font-medium", className)} {...props} />
}

/** A screen's icon: always shown when `always`, otherwise only while the sidebar is collapsed to icons. */
export function ScreenMenuIcon({ always, children }: { always?: boolean; children: React.ReactNode }) {
  return <SidebarMenuIcon className={always ? undefined : "hidden group-data-[collapsible=icon]:flex"}>{children}</SidebarMenuIcon>
}

/** A screen's name; `indented` leaves room for the icon that sits over it (and closes up when collapsed). */
export function ScreenMenuLabel({ indented, children }: { indented?: boolean; children: React.ReactNode }) {
  return <span className={indented ? "ml-6 truncate group-data-[collapsible=icon]:ml-0" : "truncate"}>{children}</span>
}

/** Text that goes away when the sidebar collapses to icons. */
export function HiddenWhenCollapsed({ children }: { children: React.ReactNode }) {
  return <span className="group-data-[collapsible=icon]:hidden">{children}</span>
}

const GROUP_INSET = { tight: "py-1", none: "p-0", condensed: "py-2" } as const

/** A group of the sidebar with its vertical padding by name. */
export function SidebarNavGroup({ inset, ...props }: { inset: keyof typeof GROUP_INSET } & Omit<React.ComponentProps<typeof SidebarGroup>, "className">) {
  return <SidebarGroup className={GROUP_INSET[inset]} {...props} />
}

/** A group's heading in the sidebar, in the quiet color. */
export function NavGroupLabel(props: Omit<React.ComponentProps<typeof SidebarGroupLabel>, "className">) {
  return <SidebarGroupLabel className="text-subtle-foreground" {...props} />
}

/** The up-down arrows at the end of the project switcher. */
export function BrandSwitchIcon() {
  return <ChevronsUpDown className="ml-auto size-4" />
}

/** The settings menu: as tall as the window allows, scrolling inside. */
export function SettingsMenuContent(props: Omit<React.ComponentProps<typeof DropdownMenuContent>, "className">) {
  return <DropdownMenuContent className="max-h-[calc(100svh-2rem)] w-64 overflow-y-auto" {...props} />
}

/** The project switcher's menu: as wide as its trigger, at least 14rem. */
export function ProjectMenuContent(props: Omit<React.ComponentProps<typeof DropdownMenuContent>, "className">) {
  return <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" {...props} />
}

/** A menu's label in the muted color. */
export function MutedMenuLabel(props: Omit<React.ComponentProps<typeof DropdownMenuLabel>, "className">) {
  return <DropdownMenuLabel className="text-muted-foreground" {...props} />
}

/** A menu's label in the strong, heading-like weight. */
export function MenuHeadingLabel(props: Omit<React.ComponentProps<typeof DropdownMenuLabel>, "className">) {
  return <DropdownMenuLabel className="text-xs font-semibold text-foreground" {...props} />
}

/** An option of the theme choice (a compact radio item). */
export function ThemeRadioItem(props: Omit<React.ComponentProps<typeof DropdownMenuRadioItem>, "className">) {
  return <DropdownMenuRadioItem className="h-7" {...props} />
}
