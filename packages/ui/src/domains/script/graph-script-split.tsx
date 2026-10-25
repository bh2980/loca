import type { ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../controls/resizable"

/** Resizable graph and reading surfaces with a session-local width preference. */
export function GraphScriptSplit({ id, graph, children }: {
  id: string
  graph: ReactNode
  children: ReactNode
}) {
  const layout = useDefaultLayout({
    id: `loca-graph-script-${id}`,
    panelIds: ["graph", "script"],
    storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
  })

  return (
    <div className="h-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
        className="h-full min-h-0 min-w-[640px] flex-1"
      >
        <ResizablePanel id="graph" defaultSize="48%" minSize="320px" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {graph}
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="그래프와 대본 너비 조절" />
        <ResizablePanel id="script" defaultSize="52%" minSize="320px" className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
