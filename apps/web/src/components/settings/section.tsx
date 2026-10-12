import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One titled block of a settings form page. Blocks stack in a column and are separated by a
 * rule, so every settings page reads the same way.
 */
export function SettingsSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4 border-t pt-8 first:border-t-0 first:pt-0', className)}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
