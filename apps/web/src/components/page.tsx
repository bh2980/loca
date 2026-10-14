import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { usePageTitle } from '@/lib/view-context';

/** The spot in the top header (right of the tabs) where a page puts its one main action. */
export const HEADER_ACTIONS_ID = 'page-header-actions';

/**
 * A page's main action ("연결 추가") shown in the top header beside the tabs, so a list does not
 * get a toolbar row of its own just for one button.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(HEADER_ACTIONS_ID)), []);
  return slot ? createPortal(children, slot) : null;
}

/**
 * Page frame. The title is shown once, in the top header; the page itself only gets a thin
 * toolbar when it has page-specific facts (`meta`) or actions, so content keeps the height.
 */
export function Page({ title, back, meta, actions, wideMeta, children, className, flush }: {
  title: string;
  /** "Back to list" link, always at the far left of the toolbar. */
  back?: ReactNode;
  /** Short page-specific facts shown left of the actions (e.g. error count, run start). */
  meta?: ReactNode;
  actions?: ReactNode;
  /** The facts are the point of the toolbar: they keep a line of their own width and push the actions to the next row when both do not fit. */
  wideMeta?: boolean;
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
          <div className={cn('min-w-0 flex-1 truncate text-sm text-muted-foreground', wideMeta && 'basis-[34rem]')}>{meta}</div>
          {actions && <div className={cn('flex shrink-0 items-center gap-2', wideMeta && 'ml-auto')}>{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? 'relative min-h-0 flex-1' : 'min-h-0 flex-1 px-6 pt-4 pb-8', className)}>{children}</div>
    </div>
  );
}
