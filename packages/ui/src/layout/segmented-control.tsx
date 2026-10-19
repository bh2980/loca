import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group';
import { cn } from '../lib/utils';

/** A single view choice, with the shared primitive's roving keyboard focus. */
export function SegmentedControl({ value, onChange, items, ariaLabel, className, disabled, variant = 'default' }: {
  value: string;
  onChange: (value: string) => void;
  /** `name` labels an item whose visible label may be icon-only. */
  items: { value: string; label: ReactNode; name?: string }[];
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
        // The selected segment sits inside the track with room around it (24px in a 32px track).
        variant === 'default' ? 'bg-muted p-1' : 'bg-transparent p-0',
        className
      )}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          aria-label={item.name}
          title={item.name}
          disabled={disabled}
          className="h-6 rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
        >
          <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:stroke-[1.65]">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
