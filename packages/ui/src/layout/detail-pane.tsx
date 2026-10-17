import type { ReactNode } from "react"
import { PaneHeader } from "./pane-header"
import { ScrollArea } from "../primitives/scroll-area"
import { Skeleton } from "../primitives/skeleton"
import { Tabs, TabsList, TabsTrigger } from "../primitives/tabs"
import { cn } from "../lib/utils"

export interface DetailPaneProps<T extends string = string> {
  kicker?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  summary?: ReactNode
  tabs?: {
    value: T
    onChange: (value: T) => void
    items: { value: T; label: ReactNode }[]
  }
  footer?: ReactNode
  loading?: boolean
  children?: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * DetailPane: right-docked detail panel with flat, crisp header, tabs, scrolling body, and footer.
 */
export function DetailPane<T extends string>({
  kicker,
  title,
  subtitle,
  actions,
  onClose,
  summary,
  tabs,
  footer,
  loading,
  children,
  className,
  bodyClassName,
}: DetailPaneProps<T>) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background border-l border-border/80", className)}>
      <PaneHeader
        kicker={kicker}
        title={title}
        subtitle={subtitle}
        actions={actions}
        onClose={onClose}
      />
      {summary && !loading && (
        <div className="shrink-0 space-y-2.5 border-b border-border/60 bg-muted/10 p-3 text-xs">
          {summary}
        </div>
      )}
      {tabs && !loading && (
        <Tabs
          value={tabs.value}
          onValueChange={(value) => tabs.onChange(value as T)}
          className="shrink-0 border-b border-border/60 px-3 py-1.5"
        >
          <TabsList variant="line" className="w-full justify-start">
            {tabs.items.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="space-y-3 p-3">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-16" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : (
          <div className={cn("space-y-5 p-3.5", bodyClassName)}>{children}</div>
        )}
      </ScrollArea>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/80 bg-background/95 px-3 py-2.5">
          {footer}
        </div>
      )}
    </div>
  )
}

/** One titled section block inside a pane or inspector column. */
export function PaneSection({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex min-h-5 items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** A "label: value" key-value row inside a pane. */
export function FieldRow({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-h-7 items-center gap-2.5 text-xs", className)}>
      <span className="w-16 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  )
}
