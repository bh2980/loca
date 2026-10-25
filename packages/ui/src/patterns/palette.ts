import { paletteIndex } from "@tw/shared"

/**
 * A stored colour as the theme shows it: a palette colour (or one of the old Tailwind colours) becomes its
 * hue variable, tuned per theme; any other hex is used as is.
 */
export function paletteColor(hex: string | null | undefined): string {
  if (!hex) return "var(--hue-1)"
  const index = paletteIndex(hex)
  return index >= 0 ? `var(--hue-${index + 1})` : hex
}

/** A tag's chip colours: a light tint behind text mixed toward the foreground, so it stays readable in both themes. */
export const chipStyle = (color: string) => {
  const hue = paletteColor(color)
  return {
    backgroundColor: `color-mix(in oklab, ${hue} 14%, transparent)`,
    color: `color-mix(in oklab, ${hue} 62%, var(--text-color-default))`,
  }
}
