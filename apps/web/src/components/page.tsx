import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { usePageTitle } from '@/lib/view-context';

/** Standard page frame: title row with actions, then content. One header per page, no extra bars. */
export function Page({ title, description, actions, children, className, flush }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Content fills the remaining height without padding (graphs, editors). */
  flush?: boolean;
}) {
  usePageTitle(typeof title === 'string' ? title : '');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5 pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn(flush ? 'relative min-h-0 flex-1 border-t' : 'min-h-0 flex-1 px-6 pb-8', className)}>{children}</div>
    </div>
  );
}
