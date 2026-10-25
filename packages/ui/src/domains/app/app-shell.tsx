import type * as React from "react"
import { Button } from "../../controls/button"

/** One of the right dock's panes: the shown one fills the dock, the other is hidden (but stays mounted). */
export function DockPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? "flex min-h-0 flex-1 flex-col" : "hidden"}>{children}</div>
}

/** A flat button on the status bar (progress, runs, notifications), opening a popover; `gap` and the layout options are the button's. */
export function StatusBarButton(props: Omit<React.ComponentProps<typeof Button>, "className" | "variant" | "size">) {
  return <Button variant="ghost" className="h-5 rounded-none px-1 text-xs font-normal text-muted hover:bg-hover hover:text-default" {...props} />
}
