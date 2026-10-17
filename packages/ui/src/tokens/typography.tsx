import * as React from 'react';
import { cn } from '../lib/utils.ts';

/**
 * Design System Typography Scale (Apple HIG & Material 3):
 * - Page Title: text-base font-semibold tracking-tight (Screen & Pane Header)
 * - Section Title: text-sm font-medium text-foreground (Grouping & Field Header)
 * - Body: text-sm leading-normal text-foreground (Standard reading & table rows)
 * - Meta / Caption: text-xs text-muted-foreground (Labels, dates, stats, hints)
 * Arbitrary text-[Npx] or random font weights are prohibited.
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
