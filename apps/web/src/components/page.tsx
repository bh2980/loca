import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePageTitle } from '@/lib/view-context';

/**
 * Page frame. The title is shown once, in the top header; the page itself only gets a thin
 * toolbar when it has page-specific facts (`meta`) or actions, so content keeps the height.
 */
export function Page({ title, meta, actions, children, className, flush }: {
  title: string;
  /** Short page-specific facts shown left of the actions (e.g. error count, run start). */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content fills the remaining height without padding (graphs, editors, tables). */
  flush?: boolean;
}) {
  usePageTitle(title);
  const toolbar = meta || actions;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar && (
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-6 py-2">
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{meta}</div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 px-6 pt-4 pb-8', className)}>{children}</div>
    </div>
  );
}
