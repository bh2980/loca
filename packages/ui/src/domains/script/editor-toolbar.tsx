import { createContext, useContext, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

const ToolbarContext = createContext<{ target: HTMLDivElement | null; setTarget: (node: HTMLDivElement | null) => void } | null>(null)

/** The editor's filters span navigation and text; data owners can supply them from below. */
export function EditorToolbarProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return <ToolbarContext.Provider value={{ target, setTarget }}>{children}</ToolbarContext.Provider>
}

/** Where the filters supplied by `EditorToolbar` are shown. */
export function EditorToolbarSlot() {
  const context = useContext(ToolbarContext)
  return <div ref={context?.setTarget} className="shrink-0" />
}

/** Filters that show in the `EditorToolbarSlot` above, wherever this is mounted. */
export function EditorToolbar({ children }: { children: ReactNode }) {
  const context = useContext(ToolbarContext)
  return context ? context.target && createPortal(children, context.target) : children
}
