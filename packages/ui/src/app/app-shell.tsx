import { Slot } from "@radix-ui/react-slot"
import type * as React from "react"
import { cn } from "../lib/utils"
import { SidebarInset, SidebarProvider } from "../layout/sidebar"
import { Badge } from "../primitives/badge"
import { Button } from "../primitives/button"
import { Empty } from "../primitives/empty"
import { GroupHeading, SectionHeading } from "../primitives/heading"
import { PopoverContent } from "../primitives/popover"
import { Progress } from "../primitives/progress"
import { Spinner } from "../primitives/spinner"

/** The project screen's error state, centered in the window. */
export function FullPageEmpty(props: React.ComponentProps<typeof Empty>) {
  return <Empty className="m-auto min-h-svh" {...props} />
}

/** The sidebar provider of the project screen: exactly the window tall, nothing scrolls outside the panes. */
export function AppShellProvider(props: React.ComponentProps<typeof SidebarProvider>) {
  return <SidebarProvider className="h-svh overflow-hidden" {...props} />
}

/** The area beside the sidebar: it may shrink and clips its panes. */
export function AppShellInset(props: React.ComponentProps<typeof SidebarInset>) {
  return <SidebarInset className="min-w-0 overflow-hidden" {...props} />
}

/** One of the right dock's panes: the shown one fills the dock, the other is hidden (but stays mounted). */
export function DockPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{children}</div>
}

const BAR_GAP = { condensed: "gap-2", snug: "gap-1.5", tight: "gap-1" } as const

/** A flat button on the status bar (progress, runs, notifications), opening a popover. */
export function StatusBarButton({ gap, className, ...props }: { gap: keyof typeof BAR_GAP } & React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" className={cn("h-5 rounded-none px-1.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground", BAR_GAP[gap], className)} {...props} />
}

/** The popover a status bar button opens; `wide` is 20rem, otherwise 18rem. */
export function StatusPopoverContent({ wide, ...props }: { wide?: boolean } & React.ComponentProps<typeof PopoverContent>) {
  return <PopoverContent className={wide ? "w-80 p-3" : "w-72 p-3"} {...props} />
}

/** A popover's section title with a hairline below it and actions on the right. */
export function PopoverSectionTitle(props: Omit<React.ComponentProps<typeof SectionHeading>, "className">) {
  return <SectionHeading className="border-b pb-2" {...props} />
}

/** A group title in a popover that sits flush against what follows. */
export function FlushGroupHeading(props: Omit<React.ComponentProps<typeof GroupHeading>, "className">) {
  return <GroupHeading className="mb-0" {...props} />
}

const ROW_LINK = {
  /** A status with its count. */
  status: "flex items-center justify-between rounded px-1.5 py-1 text-sm hover:bg-accent hover:text-accent-foreground",
  /** Something needing a look, in the warning color. */
  review: "flex items-center justify-between rounded px-1.5 py-1 text-sm text-warning hover:bg-warning/10",
  /** A run with its progress bar below. */
  run: "block space-y-1 rounded p-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
  /** A recent run on one line. */
  recent: "flex items-center justify-between rounded p-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
} as const

/** Makes the link inside it a row of a popover list. */
export function PopoverRowLink({ variant, children }: { variant: keyof typeof ROW_LINK; children: React.ReactNode }) {
  return <Slot className={ROW_LINK[variant]}>{children}</Slot>
}

/** Makes the link inside it a small underlined link (the "see all" beside a popover title). */
export function PopoverActionLink({ children }: { children: React.ReactNode }) {
  return <Slot className="text-xs font-normal text-muted-foreground underline hover:text-foreground">{children}</Slot>
}

/** The box in the notifications popover for what waits for a decision. */
export function NoticeBox({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5">{children}</div>
}

/** A small badge with a count or a run's state, one text size. */
export function CountBadge(props: React.ComponentProps<typeof Badge>) {
  return <Badge className="text-xs" {...props} />
}

/** A run's state, as a small non-shrinking badge. */
export function RunStatusBadge(props: React.ComponentProps<typeof Badge>) {
  return <Badge className="h-4 shrink-0 px-1 text-xs" {...props} />
}

/** A run's progress bar, thin, filling the row. */
export function RunProgressBar(props: Omit<React.ComponentProps<typeof Progress>, "className">) {
  return <Progress className="h-1 flex-1" {...props} />
}

/** A small spinner in the accent color; `fixed` keeps it from shrinking in a row. */
export function AccentSpinner({ fixed }: { fixed?: boolean }) {
  return <Spinner className={cn("size-3 text-primary", fixed && "shrink-0")} />
}
