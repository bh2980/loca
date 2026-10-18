import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group';
import { cn } from '../lib/utils';

/** A single view choice, with the shared primitive's roving keyboard focus. */
export function SegmentedControl({ value, onChange, items, ariaLabel, className, disabled, variant = 'default' }: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: ReactNode }[];
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  variant?: 'default' | 'ghost';
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => { if (next) onChange(next); }}
      aria-label={ariaLabel}
      spacing={1}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 items-center gap-0.5 rounded-md',
        variant === 'default' ? 'bg-muted p-0.5' : 'bg-transparent p-0',
        className
      )}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          disabled={disabled}
          className="h-7 rounded-md border border-transparent px-2.5 text-xs text-muted-foreground transition-all hover:bg-accent hover:text-foreground data-[state=on]:border-primary/50 data-[state=on]:bg-selection data-[state=on]:font-semibold data-[state=on]:text-foreground data-[state=on]:shadow-2xs"
        >
          <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:stroke-[1.65]">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
