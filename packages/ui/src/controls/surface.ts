import { STYLE } from "../primitives/style"

/** The widths a menu or a floating surface takes: the `menu*` and `popover*` names of tokens/system.css. */
export type SurfaceWidth = Extract<keyof typeof STYLE.width, `menu${string}` | `popover${string}`>

/** What a menu or popover content takes besides its parts: how wide, how much padding, where it stops growing (it scrolls past that). */
export type SurfaceProps = {
  /** Its width, by token name (`menu-xl` 16rem, `popover` 20rem ...). */
  width?: SurfaceWidth
  /** Its padding, by spacing name. */
  padding?: keyof typeof STYLE.padding
  /** The height it stops growing at, by token name; it scrolls past that. */
  maxHeight?: keyof typeof STYLE.maxHeight
}

/** The classes of the options; `scroll` is the overflow a surface that scrolls takes. */
export function surfaceClass({ width, padding, maxHeight }: SurfaceProps, scroll: string, extraWidth?: string) {
  return [extraWidth ?? (width && STYLE.width[width]), padding && STYLE.padding[padding], maxHeight && STYLE.maxHeight[maxHeight], maxHeight && scroll]
}
