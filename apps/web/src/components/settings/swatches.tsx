/** The color palette (and a free picker) used by status, tag and mark panes. */
import { STATUS_COLORS } from '@tw/shared';
import { StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="색상">
      {STATUS_COLORS.map((color) => (
        <Button
          key={color}
          type="button"
          variant="ghost"
          size="icon"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn(value === color && 'bg-muted ring-1 ring-foreground/40')}
        >
          <StatusDot color={color} className="size-4" />
        </Button>
      ))}
      {/* Any other color: the browser's picker, shown filled when the color is not in the palette. */}
      <label className={cn('relative flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted', !STATUS_COLORS.includes(value) && 'bg-muted ring-1 ring-foreground/40')} title="다른 색">
        <span aria-hidden className="size-4 rounded-full border" style={STATUS_COLORS.includes(value) ? { background: 'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #d946ef, #ef4444)' } : { backgroundColor: value }} />
        <Input type="color" aria-label="다른 색" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}
