import type { HTMLAttributes, ReactNode } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "../lib/utils"

export function NavigationPane({ search, children, footer, className }: { search?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <aside className={cn("flex h-full min-h-0 flex-col bg-navigation", className)}>
      {search && <div className="shrink-0 border-b border-border-subtle p-2">{search}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">{children}</div>
      {footer && <footer className="shrink-0 border-t border-border-subtle p-2">{footer}</footer>}
    </aside>
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
  const itemClassName = cn("flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs tracking-tight transition-colors", active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground", className)
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
