import type { CSSProperties, ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../primitives/resizable"
import { cn } from "../lib/utils"
import { DockContent, DockLevel, useHasDock } from './right-dock'

export interface SplitPaneProps {
  id: string
  pane: ReactNode
  /** Stable selected entity identity; changing it reveals the shared inspector. */
  selectionKey?: string
  children: ReactNode
  defaultWidth?: string
  className?: string
  /** Fills its (positioned) parent instead of taking its size from the flow. */
  fill?: boolean
  style?: CSSProperties
  autoActivate?: boolean
}

/**
 * SplitPane: resizable horizontal panel group for main content + right-hand detail pane.
 */
export function SplitPane({
  id,
  pane,
  selectionKey,
  children,
  defaultWidth = "420px",
  className: given,
  fill,
  style,
  autoActivate,
}: SplitPaneProps) {
  const className = cn(fill && "absolute inset-0", given)
  const dock = useHasDock()
  if (dock) return <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)} style={style}>
    <DockContent selectionKey={selectionKey} autoActivate={autoActivate}>{pane}</DockContent>
    <DockLevel>{children}</DockLevel>
  </div>
  return <LocalSplitPane id={id} pane={pane} defaultWidth={defaultWidth} className={className} style={style}>{children}</LocalSplitPane>
}

function LocalSplitPane({ id, pane, children, defaultWidth, className, style }: SplitPaneProps) {
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
      className={cn("min-h-0", className)}
      style={style}
    >
      <ResizablePanel id="content" minSize="320px" className="flex min-w-0 flex-col">
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
