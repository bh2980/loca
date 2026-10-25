import type { ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../controls/resizable"
import { cn } from "../lib/utils"
import { DockContent, DockLevel, useHasDock } from "./right-dock"

export interface SplitPaneProps {
  id: string
  pane: ReactNode
  /** Stable selected entity identity; changing it reveals the shared inspector. */
  selectionKey?: string
  children: ReactNode
  defaultWidth?: string
  /** The least width of the content beside the pane. */
  minSize?: string
  /** `true` fills its (positioned) parent; `"height"` is as tall as its parent; otherwise it takes its size from the flow. */
  fill?: boolean | "height"
  autoActivate?: boolean
}

const FILL = { true: "absolute inset-0", height: "h-full" } as const

/**
 * SplitPane: resizable horizontal panel group for main content + right-hand detail pane.
 */
export function SplitPane({
  id,
  pane,
  selectionKey,
  children,
  defaultWidth = "420px",
  minSize = "320px",
  fill,
  autoActivate,
}: SplitPaneProps) {
  const fillClass = fill ? FILL[fill === true ? "true" : fill] : undefined
  const dock = useHasDock()
  if (dock) return <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', fillClass)}>
    <DockContent selectionKey={selectionKey} autoActivate={autoActivate}>{pane}</DockContent>
    <DockLevel>{children}</DockLevel>
  </div>
  return <LocalSplitPane id={id} pane={pane} defaultWidth={defaultWidth} minSize={minSize} fillClass={fillClass}>{children}</LocalSplitPane>
}

function LocalSplitPane({ id, pane, children, defaultWidth, minSize, fillClass }: Pick<SplitPaneProps, "id" | "pane" | "children" | "defaultWidth" | "minSize"> & { fillClass?: string }) {
  const open = Boolean(pane)
  const layout = useDefaultLayout({
    id: `loca-pane-${id}`,
    panelIds: open ? ["content", "pane"] : ["content"],
    storage: typeof window !== "undefined" ? localStorage : undefined,
  })

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className={cn("min-h-0", fillClass)}
    >
      <ResizablePanel id="content" minSize={minSize} className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
      {open && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="pane"
            defaultSize={defaultWidth}
            minSize="280px"
            maxSize="70%"
            className="min-w-0"
          >
            {pane}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
}
