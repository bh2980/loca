/** The color palette (and a free picker) used by status, tag and mark panes. */
import { PALETTE, paletteIndex } from '@tw/shared';
import { Inline, NO_COLOR_PICKER_DEFAULT, PickerSwatch, PickerSwatchInput, SwatchButton, SwatchDot, paletteColor } from '@loca/ui';

/** The free picker's swatch while a palette colour is chosen: the palette's hues around a circle. */
const WHEEL = `conic-gradient(${PALETTE.slice(1).map((_, index) => `var(--hue-${index + 2})`).join(', ')}, var(--hue-2))`;

/** `onClear` adds 없음 first (a person's color may be none: value ''). */
export function Swatches({ value, onChange, onClear }: { value: string; onChange: (color: string) => void; onClear?: () => void }) {
  // A colour from the old 20-colour palette counts as the palette colour it is shown as.
  const current = value ? paletteIndex(value) : null;
  return (
    <Inline wrap gap="tight" role="radiogroup" aria-label="색상">
      {onClear && (
        <SwatchButton type="button" variant="ghost" role="radio" aria-checked={!value} onClick={onClear} selected={!value}>
          없음
        </SwatchButton>
      )}
      {PALETTE.map((color, index) => (
        <SwatchButton
          key={color.hex}
          type="button"
          variant="ghost"
          size="icon"
          role="radio"
          aria-checked={current === index}
          aria-label={color.name}
          title={color.name}
          onClick={() => onChange(color.hex)}
          selected={current === index}
        >
          <SwatchDot style={{ backgroundColor: paletteColor(color.hex) }} />
        </SwatchButton>
      ))}
      {/* Any other color: the browser's picker, shown filled when the color is not in the palette. */}
      <PickerSwatch selected={current !== null && current < 0} title="다른 색">
        <SwatchDot style={current === null || current >= 0 ? { background: WHEEL } : { backgroundColor: paletteColor(value) }} />
        <PickerSwatchInput aria-label="다른 색" value={value || NO_COLOR_PICKER_DEFAULT} onChange={(event) => onChange(event.target.value)} />
      </PickerSwatch>
    </Inline>
  );
}
