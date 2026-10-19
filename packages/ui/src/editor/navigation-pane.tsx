import { useEffect, type HTMLAttributes, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { usePanelRef } from "react-resizable-panels"
import { Slot } from "@radix-ui/react-slot"
import { ResizableHandle, ResizablePanel } from "../primitives/resizable"
import { Button } from "../primitives/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { cn } from "../lib/utils"
import { usePanelWidth } from "../layout/use-panel-width"

/** A collapsible, pixel-persisted navigation pane that keeps its route content mounted. */
export function ResizableNavigationPanel({ id, widthKey, defaultWidth = 216, open, children, className }: {
  id: string
  widthKey: string
  defaultWidth?: number
  open: boolean
  children: ReactNode
  className?: string
}) {
  const panel = usePanelRef()
  const { getPixelWidth, ...width } = usePanelWidth(widthKey, defaultWidth)
  useEffect(() => { if (open) panel.current?.resize(`${getPixelWidth()}px`); else panel.current?.collapse(); }, [open, panel, getPixelWidth])
  return <>
    <ResizablePanel id={id} panelRef={panel} {...width} minSize="180px" maxSize="50%" collapsible collapsedSize={0} className={cn("min-w-0", className)}>
      <div className={cn("h-full min-h-0", !open && "hidden")} inert={!open} aria-hidden={!open || undefined}>{children}</div>
    </ResizablePanel>
    <ResizableHandle className={cn(!open && "hidden")} />
  </>
}

export function NavigationPane({ search, children, footer, className }: { search?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-col bg-navigation", className)}>
      {search && <div className="shrink-0 border-b border-border-subtle p-2">{search}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border-subtle p-2">{footer}</footer>}
    </aside>
  )
}

/** A controlled navigation branch with a separate expand control and navigation link. */
export function NavigationBranch({ label, open, onOpenChange, navigation, children, disabled = false, className }: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Sibling of the expand button, usually a link that selects this branch. */
  navigation: ReactNode
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn("mt-2", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${open ? "접기" : "펴기"} ${label}`} aria-expanded={open} title={`${open ? "접기" : "펴기"} ${label}`}>
            <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
          </Button>
        </CollapsibleTrigger>
        {navigation}
      </div>
      <CollapsibleContent className="pl-8">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function NavigationItem({ active = false, icon, label, trailing, asChild = false, className, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  active?: boolean
  icon?: ReactNode
  label?: ReactNode
  trailing?: ReactNode
  asChild?: boolean
  children?: ReactNode
}) {
  const Component = asChild ? Slot : "div"
  const itemClassName = commonNavigationItem(active, className)
  if (asChild) return <Component className={itemClassName} aria-current={active ? "page" : undefined} {...props}>{children}</Component>
  return (
    <Component
      className={itemClassName}
      aria-current={active ? "page" : undefined}
      {...props}
    >
      {icon}<span className="min-w-0 flex-1 truncate">{label ?? children}</span>{trailing}
    </Component>
  )
}

export function commonNavigationItem(active: boolean, className?: string) {
  return cn(
    "flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs tracking-tight transition-colors",
    active ? "bg-selection font-semibold text-foreground ring-1 ring-inset ring-primary/50" : "text-muted-foreground hover:bg-accent hover:text-foreground",
    className,
  )
}
