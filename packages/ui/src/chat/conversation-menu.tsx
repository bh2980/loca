import type * as React from "react"
import { History, Search } from "lucide-react"
import { Button, type ButtonProps } from "../primitives/button"
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "../primitives/dropdown-menu"
import { Input } from "../primitives/input"
import { cn } from "../lib/utils"

/** The button that opens the conversation list: the current conversation's title beside a history icon. */
export function ConversationMenuTrigger({ title, ...props }: Omit<ButtonProps, "children" | "title"> & { title: string }) {
  return (
    <Button variant="ghost" className="min-w-0 flex-1 justify-start" {...props}>
      <History className="text-muted-foreground" />
      <span className="truncate">{title}</span>
    </Button>
  )
}

export function ConversationMenuContent(props: React.ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align="start" className="w-80" {...props} />
}

export function ConversationMenuHeading({ children }: { children: React.ReactNode }) {
  return <DropdownMenuLabel className="text-xs font-semibold text-foreground">{children}</DropdownMenuLabel>
}

/** The search field at the top of the list: an input with a magnifier inside. */
export function ConversationSearchField(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative px-1 pb-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-[60%] text-muted-foreground" />
      <Input className="pl-7" {...props} />
    </div>
  )
}

/** A conversation found by a search: its title and, when the match was in a message, the snippet. */
export function ConversationHit({ title, snippet, current, ...props }: Omit<React.ComponentProps<typeof DropdownMenuItem>, "children"> & { title: string; snippet?: string; current?: boolean }) {
  return (
    <DropdownMenuItem className={cn("flex-col items-start gap-0", current && "font-medium")} {...props}>
      <span className="w-full truncate">{title}</span>
      {snippet !== undefined && <span className="w-full truncate text-xs font-normal text-muted-foreground">{snippet}</span>}
    </DropdownMenuItem>
  )
}

/** A conversation in the list; its row actions (`ConversationRowAction`) show on hover or focus. */
export function ConversationItem({ current, ...props }: React.ComponentProps<typeof DropdownMenuItem> & { current?: boolean }) {
  return <DropdownMenuItem className={cn("group/session pr-1", current && "font-medium")} {...props} />
}

export function ConversationRowAction({ danger = false, ...props }: ButtonProps & { danger?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted-foreground opacity-0 group-hover/session:opacity-100 group-focus/session:opacity-100", danger && "hover:text-destructive")}
      {...props}
    />
  )
}
