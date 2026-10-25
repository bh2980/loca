import { useEffect, type ReactNode } from "react"
import { usePanelRef } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../controls/resizable"
import { cn } from "../../lib/utils"
import { usePanelWidth } from "../../lib/use-panel-width"

/**
 * The scene list and the lines side by side. The list is a collapsible pane whose width is kept in pixels for this tab; it stays
 * mounted (inert) while closed, so its search and unfolded sections survive.
 */
export function ScriptWorkspace({ navigation, open, children }: { navigation: ReactNode; open: boolean; children: ReactNode }) {
  const panel = usePanelRef()
  const { getPixelWidth, ...width } = usePanelWidth("script-groups", 216)
  useEffect(() => { if (open) panel.current?.resize(`${getPixelWidth()}px`); else panel.current?.collapse() }, [open, panel, getPixelWidth])
  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel id="groups" panelRef={panel} {...width} minSize="180px" maxSize="50%" collapsible collapsedSize={0} className="min-w-0">
        <div className={cn("h-full min-h-0", !open && "hidden")} inert={!open} aria-hidden={!open || undefined}>{navigation}</div>
      </ResizablePanel>
      <ResizableHandle className={cn(!open && "hidden")} />
      <ResizablePanel id="lines" minSize="360px" className="flex min-w-0 flex-col">{children}</ResizablePanel>
    </ResizablePanelGroup>
  )
}
