import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The bar that replaces a list's header while rows are picked: 'n개 선택 · actions · 선택 해제'.
 * Used by DataTable and the script list. It is a container (`picked`): put `PickedLabel` around
 * a button's text and the text hides when the bar is narrow, so the bar keeps to one row.
 */
export function PickedBar({ count, onClear, children, className }: { count: number; onClear: () => void; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('@container/picked flex min-w-0 flex-wrap items-center gap-2 text-sm', className)}>
      <span className="shrink-0 font-medium text-foreground tabular-nums">
        {count.toLocaleString()}개<span className="hidden @md/picked:inline"> 선택</span>
      </span>
      {children}
      <Button variant="ghost" className="ml-auto shrink-0" aria-label="선택 해제" title="선택 해제" onClick={onClear}>
        <X />
        <span className="hidden @xl/picked:inline">선택 해제</span>
      </Button>
    </div>
  );
}

/** A button's text inside a PickedBar: shown from `md` (or `lg`) container width up. */
export function PickedLabel({ children, from = 'md' }: { children: ReactNode; from?: 'md' | 'lg' }) {
  return <span className={from === 'lg' ? 'hidden @lg/picked:inline' : 'hidden @md/picked:inline'}>{children}</span>;
}
