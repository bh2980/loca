import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group';
import { cn } from '../lib/utils';

/** A single view choice, with the shared primitive's roving keyboard focus. */
export function SegmentedControl({ value, onChange, items, ariaLabel, className }: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: ReactNode }[];
  ariaLabel: string;
  className?: string;
}) {
  return <ToggleGroup type="single" value={value} onValueChange={(next) => { if (next) onChange(next); }} aria-label={ariaLabel} spacing={1} className={cn('inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5', className)}>
    {items.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="h-7 rounded-md border border-transparent px-2.5 text-xs data-[state=on]:border-border-subtle data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-2xs dark:data-[state=on]:border-border dark:data-[state=on]:bg-accent">
      {item.label}
    </ToggleGroupItem>)}
  </ToggleGroup>;
}
