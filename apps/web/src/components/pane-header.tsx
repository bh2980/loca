import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The header every right-hand pane uses: what kind of thing it is (kicker), its name, a line of
 * facts under it, the pane's own actions, then the close button.
 */
export function PaneHeader({ kicker, title, subtitle, icon, actions, onClose }: { kicker?: ReactNode; title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-start gap-2 border-b px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        {kicker && <div className="text-xs text-muted-foreground">{kicker}</div>}
        <h2 className="truncate text-sm font-medium">{title}</h2>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {actions}
      {onClose && (
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      )}
    </div>
  );
}
