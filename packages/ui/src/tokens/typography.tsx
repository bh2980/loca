import * as React from 'react';
import { cn } from '../lib/utils.ts';

/**
 * Shared type roles. Sizes and weights are mapped in tokens/system.css so app consumers share them.
 * Keep labels, body copy, and metadata distinct through role and weight rather than custom sizes.
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
    <h2 className={cn('text-sm font-semibold text-foreground', className)} {...props}>
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
