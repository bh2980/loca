import type { ReactNode } from 'react';
import { PaneHeader } from '@/components/pane-header';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Every right-hand pane: header (kind · name · one line of facts · close), optional tabs, the
 * scrolling body made of `PaneSection`s, and the pane's actions pinned to the bottom.
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
  bodyClassName,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small header actions (links to related screens). The main action goes in `footer`. */
  actions?: ReactNode;
  onClose?: () => void;
  /** Always-visible facts above the tabs (a line's source, status, listener). */
  summary?: ReactNode;
  tabs?: { value: T; onChange: (value: T) => void; items: { value: T; label: ReactNode }[] };
  footer?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <PaneHeader kicker={kicker} title={title} subtitle={subtitle} actions={actions} onClose={onClose} />
      {summary && !loading && <div className="shrink-0 space-y-3 border-b p-4">{summary}</div>}
      {tabs && !loading && (
        <Tabs value={tabs.value} onValueChange={(value) => tabs.onChange(value as T)} className="shrink-0 border-b px-4 py-2">
          <TabsList>
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
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className={cn('space-y-6 p-4', bodyClassName)}>{children}</div>
        )}
      </ScrollArea>
      {footer && <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3">{footer}</div>}
    </div>
  );
}

/** One titled block of a pane (or of a page's side column). */
export function PaneSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A "name: value" line inside a pane. */
export function FieldRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
