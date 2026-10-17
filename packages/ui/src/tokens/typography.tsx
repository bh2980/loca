import * as React from 'react';
import { cn } from '../lib/utils.ts';

/**
 * Type roles (#48; the sizes are in apps/web/src/index.css @theme, docs/UI-AUDIT-48.md):
 * - Page title: text-xl font-semibold (19px)
 * - Pane / section title: text-base font-semibold (15px), or text-sm font-medium for a field group
 * - Body: text-sm (14px): table rows, chat replies, form values, descriptions people read
 * - Meta: text-xs text-muted-foreground (13px): dates, counts, hints, column heads
 * - Badge / counter: text-2xs (11.5px), the floor; nothing smaller
 * Arbitrary text-[Npx] sizes are refused by `pnpm ui-rules`, here as in the app.
 */

export function PageTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1 className={cn('text-base font-semibold tracking-tight text-foreground', className)} {...props}>
      {children}
    </h1>
  );
}

export function SectionTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('text-sm font-medium text-foreground', className)} {...props}>
      {children}
    </h2>
  );
}

export function BodyText({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-foreground leading-normal', className)} {...props}>
      {children}
    </p>
  );
}

export function MetaText({ className, children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('text-xs text-muted-foreground font-normal', className)} {...props}>
      {children}
    </span>
  );
}
