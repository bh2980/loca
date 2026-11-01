import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';
import { cn } from '../lib/utils';

/** A single view choice, with the shared primitive's roving keyboard focus. */
export function SegmentedControl({ value, onChange, items, ariaLabel, disabled, variant = 'default', fill, fixed }: {
  value: string;
  onChange: (value: string) => void;
  /** `name` labels an item whose visible label may be icon-only. */
  items: { value: string; label: ReactNode; name?: string }[];
  ariaLabel: string;
  disabled?: boolean;
  /** `pills`: separate rounded choices, the picked one filled (a list's filter: 전체 · 번역만 · 실행). */
  variant?: 'default' | 'ghost' | 'pills';
  /** Takes the width of its container, every segment equally wide (the show / hide switch of a filter menu). */
  fill?: boolean;
  /** Keeps its size in a row that is too narrow. */
  fixed?: boolean;
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
        variant === 'default' ? 'bg-sunken p-1' : 'bg-transparent p-0',
        variant === 'pills' && 'h-auto flex-wrap gap-1.5',
        fill && 'flex w-full [&>*]:flex-1',
        fixed && 'shrink-0'
      )}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          aria-label={item.name}
          title={item.name}
          disabled={disabled}
          className={variant === 'pills'
            ? 'h-6 rounded-full border border-default px-2.5 text-xs font-medium text-muted transition-colors hover:text-default data-[state=on]:border-transparent data-[state=on]:bg-inverse data-[state=on]:text-inverse'
            : 'h-6 rounded-sm px-2 text-xs font-medium text-muted transition-colors hover:text-default data-[state=on]:bg-page data-[state=on]:text-default data-[state=on]:shadow-xs'}
        >
          <span className="inline-flex items-center gap-1 [&_svg]:size-3.5 [&_svg]:stroke-[1.65]">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
