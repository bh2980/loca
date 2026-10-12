import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePageTitle } from '@/lib/view-context';

/**
 * Page frame. The title is shown once, in the top header; the page itself only gets a thin
 * toolbar when it has page-specific facts (`meta`) or actions, so content keeps the height.
 */
export function Page({ title, back, meta, actions, children, className, flush }: {
  title: string;
  /** "Back to list" link, always at the far left of the toolbar. */
  back?: ReactNode;
  /** Short page-specific facts shown left of the actions (e.g. error count, run start). */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content fills the remaining height without padding (graphs, editors, tables). */
  flush?: boolean;
}) {
  usePageTitle(title);
  const toolbar = back || meta || actions;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar && (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          {back && <div className="-ml-2 shrink-0">{back}</div>}
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{meta}</div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 px-6 pt-4 pb-8', className)}>{children}</div>
    </div>
  );
}
