/** The color palette (and a free picker) used by status, tag and mark panes. */
import { PALETTE, paletteIndex } from '@tw/shared';
import { Button, Input, paletteColor } from '@loca/ui';
import { cn } from '@/lib/utils';

/** The free picker's swatch while a palette colour is chosen: the palette's hues around a circle. */
const WHEEL = `conic-gradient(${PALETTE.slice(1).map((_, index) => `var(--hue-${index + 2})`).join(', ')}, var(--hue-2))`;

export function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  // A colour from the old 20-colour palette counts as the palette colour it is shown as.
  const current = paletteIndex(value);
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="색상">
      {PALETTE.map((color, index) => (
        <Button
          key={color.hex}
          type="button"
          variant="ghost"
          size="icon"
          role="radio"
          aria-checked={current === index}
          aria-label={color.name}
          title={color.name}
          onClick={() => onChange(color.hex)}
          className={cn(current === index && 'bg-muted ring-1 ring-foreground/40')}
        >
          <span aria-hidden className="size-4 rounded-full" style={{ backgroundColor: paletteColor(color.hex) }} />
        </Button>
      ))}
      {/* Any other color: the browser's picker, shown filled when the color is not in the palette. */}
      <label className={cn('relative flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted', current < 0 && 'bg-muted ring-1 ring-foreground/40')} title="다른 색">
        <span aria-hidden className="size-4 rounded-full" style={current >= 0 ? { background: WHEEL } : { backgroundColor: value }} />
        <Input type="color" aria-label="다른 색" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}
