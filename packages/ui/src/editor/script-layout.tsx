import { Slot } from "@radix-ui/react-slot"
import type { ComponentProps, ComponentType, ReactNode } from "react"
import { cn } from "../lib/utils"
import { Page } from "../layout/page"
import { SplitPane } from "../layout/split-pane"
import { HoverCardContent } from "../primitives/hover-card"
import { ResizablePanel, ResizablePanelGroup } from "../primitives/resizable"
import { commonNavigationItem } from "./navigation-pane"

/** The translation screen's page: its content is a column. `frame` is the app's page (it sets the document title); the plain `Page` by default. */
export function ScriptPage({ frame: Frame = Page, ...props }: Omit<ComponentProps<typeof Page>, "className"> & { frame?: ComponentType<ComponentProps<typeof Page>> }) {
  return <Frame {...props} className="flex flex-col" />
}

/** The scene list and the lines side by side. */
export function ScriptWorkspace(props: Omit<ComponentProps<typeof ResizablePanelGroup>, "className">) {
  return <ResizablePanelGroup {...props} className="min-h-0 flex-1" />
}

/** The panel that holds the lines, as a column. */
export function ScriptLinesPanel(props: Omit<ComponentProps<typeof ResizablePanel>, "className">) {
  return <ResizablePanel {...props} className="flex min-w-0 flex-col" />
}

/** The lines with the detail pane beside them, filling the panel. */
export function ScriptLineSplit(props: Omit<ComponentProps<typeof SplitPane>, "className">) {
  return <SplitPane {...props} className="h-full min-h-0" />
}

/** The band under the toolbar that says the filter is walked inside the scene (the matches marked). */
export function ScriptFindBar({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2 border-b bg-warning/5 px-4 py-1.5 text-sm">{children}</div>
}

/** The open scene's name in the page heading, cut to a short width. */
export function ScriptCrumb({ children }: { children: ReactNode }) {
  return <span className="max-w-48 truncate text-xs text-muted-foreground">{children}</span>
}

/** The link of a section in the scene list, put on the one link inside. */
export function ScriptSectionNavLink({ active, children }: { active: boolean; children: ReactNode }) {
  return <Slot className={commonNavigationItem(active, "min-w-0 flex-1")}>{children}</Slot>
}

/** The link of a scene in the scene list (two rows: name and meter), put on the one link inside. `complete`: every line is final. */
export function ScriptGroupNavLink({ active, complete, children }: { active: boolean; complete: boolean; children: ReactNode }) {
  return (
    <Slot className={commonNavigationItem(active, cn("h-auto min-h-7 flex-col items-stretch gap-1 py-1 px-2", !active && "text-foreground/90", complete && !active && "text-subtle-foreground"))}>
      {children}
    </Slot>
  )
}

/** The icon of a kind or the review box in the scene list: small and muted. */
export function ScriptNavIcon({ children }: { children: ReactNode }) {
  return <span className="[&_svg]:size-3.5 [&_svg]:text-muted-foreground">{children}</span>
}

/** How many lines of a scene match the walked filter. */
export function ScriptMarkCount({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 text-xs font-mono text-warning tabular-nums">{children}</span>
}

/** The hover card of a speaker's name. */
export function ScriptSpeakerCardContent(props: Omit<ComponentProps<typeof HoverCardContent>, "className">) {
  return <HoverCardContent {...props} className="w-80 space-y-2 text-sm" />
}

/** A character's profile in the speaker card, cut to four lines. */
export function ScriptSpeakerProfile({ children }: { children: ReactNode }) {
  return <p className="line-clamp-4">{children}</p>
}

/** The quiet link at the foot of the speaker card, put on the one link inside. */
export function ScriptSpeakerCardLink({ children }: { children: ReactNode }) {
  return <Slot className="block text-xs text-muted-foreground underline-offset-2 hover:underline">{children}</Slot>
}
