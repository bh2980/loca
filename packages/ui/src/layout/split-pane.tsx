import type { CSSProperties, ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../primitives/resizable"
import { cn } from "../lib/utils"

export interface SplitPaneProps {
  id: string
  pane: ReactNode
  children: ReactNode
  defaultWidth?: string
  className?: string
  style?: CSSProperties
}

/**
 * SplitPane: resizable horizontal panel group for main content + right-hand detail pane.
 */
export function SplitPane({
  id,
  pane,
  children,
  defaultWidth = "420px",
  className,
  style,
}: SplitPaneProps) {
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
