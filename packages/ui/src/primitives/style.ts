import { cva, type VariantProps } from "class-variance-authority"

/**
 * The options every layout and text part shares (Box, Stack, Inline, Grid, Text, Heading, Icon and the layout options of Button), by token
 * name. A screen arranges and styles with these and never writes a class; anything they cannot say belongs in a component of its own
 * (packages/ui). Every value is written out in full so Tailwind finds each class in this file. An option that serves one part (a
 * graph handle, a row's hover action, a list item's trimmed ends) is a prop of that part, not an option here; sizes take only the
 * names of tokens/system.css, never a number or a length (`pnpm ui-rules` refuses one in this file).
 *
 * Spacing names (padding, margin, gap, space): none 0, hair 2px, tight 4px, snug 6px, condensed 8px, cozy 10px, normal 12px,
 * comfortable 16px, roomy 20px, spacious 24px, wide 32px, section 48px.
 */
export const SPACING_PX = {
  none: 0, // 0
  hair: 2, // 0.5
  tight: 4, // 1
  snug: 6, // 1.5
  condensed: 8, // 2
  cozy: 10, // 2.5
  normal: 12, // 3
  comfortable: 16, // 4
  roomy: 20, // 5
  spacious: 24, // 6
  wide: 32, // 8
  section: 48, // 12
} as const

/** The gap between the children of a Stack, an Inline or a Grid (all sides, or across / down only). */
export const GAP = {
  gap: {
    none: "gap-0",
    hair: "gap-0.5",
    tight: "gap-1",
    snug: "gap-1.5",
    condensed: "gap-2",
    cozy: "gap-2.5",
    normal: "gap-3",
    comfortable: "gap-4",
    roomy: "gap-5",
    spacious: "gap-6",
    wide: "gap-8",
    section: "gap-12",
  },
  gapX: {
    none: "gap-x-0",
    hair: "gap-x-0.5",
    tight: "gap-x-1",
    snug: "gap-x-1.5",
    condensed: "gap-x-2",
    cozy: "gap-x-2.5",
    normal: "gap-x-3",
    comfortable: "gap-x-4",
    roomy: "gap-x-5",
    spacious: "gap-x-6",
    wide: "gap-x-8",
    section: "gap-x-12",
  },
  gapY: {
    none: "gap-y-0",
    hair: "gap-y-0.5",
    tight: "gap-y-1",
    snug: "gap-y-1.5",
    condensed: "gap-y-2",
    cozy: "gap-y-2.5",
    normal: "gap-y-3",
    comfortable: "gap-y-4",
    roomy: "gap-y-5",
    spacious: "gap-y-6",
    wide: "gap-y-8",
    section: "gap-y-12",
  },
} as const

export const STYLE = {
  padding: {
    none: "p-0",
    hair: "p-0.5",
    tight: "p-1",
    snug: "p-1.5",
    condensed: "p-2",
    cozy: "p-2.5",
    normal: "p-3",
    comfortable: "p-4",
    roomy: "p-5",
    spacious: "p-6",
    wide: "p-8",
    section: "p-12",
  },
  paddingX: {
    none: "px-0",
    hair: "px-0.5",
    tight: "px-1",
    snug: "px-1.5",
    condensed: "px-2",
    cozy: "px-2.5",
    normal: "px-3",
    comfortable: "px-4",
    roomy: "px-5",
    spacious: "px-6",
    wide: "px-8",
    section: "px-12",
    page: "px-4 sm:px-6",
  },
  paddingY: {
    none: "py-0",
    hair: "py-0.5",
    tight: "py-1",
    snug: "py-1.5",
    condensed: "py-2",
    cozy: "py-2.5",
    normal: "py-3",
    comfortable: "py-4",
    roomy: "py-5",
    spacious: "py-6",
    wide: "py-8",
    section: "py-12",
  },
  paddingTop: {
    none: "pt-0",
    hair: "pt-0.5",
    tight: "pt-1",
    snug: "pt-1.5",
    condensed: "pt-2",
    cozy: "pt-2.5",
    normal: "pt-3",
    comfortable: "pt-4",
    roomy: "pt-5",
    spacious: "pt-6",
    wide: "pt-8",
    section: "pt-12",
  },
  paddingBottom: {
    none: "pb-0",
    hair: "pb-0.5",
    tight: "pb-1",
    snug: "pb-1.5",
    condensed: "pb-2",
    cozy: "pb-2.5",
    normal: "pb-3",
    comfortable: "pb-4",
    roomy: "pb-5",
    spacious: "pb-6",
    wide: "pb-8",
    section: "pb-12",
    /** Clear of the status bar that overlays the bottom of a pane (28px). */
    statusBar: "pb-7",
  },
  paddingLeft: {
    none: "pl-0",
    hair: "pl-0.5",
    tight: "pl-1",
    snug: "pl-1.5",
    condensed: "pl-2",
    cozy: "pl-2.5",
    normal: "pl-3",
    comfortable: "pl-4",
    roomy: "pl-5",
    spacious: "pl-6",
    wide: "pl-8",
    section: "pl-12",
    /** Nested content under a row's icon and label (36px). */
    indent: "pl-9",
  },
  paddingRight: {
    none: "pr-0",
    hair: "pr-0.5",
    tight: "pr-1",
    snug: "pr-1.5",
    condensed: "pr-2",
    cozy: "pr-2.5",
    normal: "pr-3",
    comfortable: "pr-4",
    roomy: "pr-5",
    spacious: "pr-6",
    wide: "pr-8",
    section: "pr-12",
  },
  marginTop: {
    none: "mt-0",
    hair: "mt-0.5",
    tight: "mt-1",
    snug: "mt-1.5",
    condensed: "mt-2",
    cozy: "mt-2.5",
    normal: "mt-3",
    comfortable: "mt-4",
    roomy: "mt-5",
    spacious: "mt-6",
    wide: "mt-8",
    section: "mt-12",
    auto: "mt-auto",
  },
  marginBottom: {
    none: "mb-0",
    hair: "mb-0.5",
    tight: "mb-1",
    snug: "mb-1.5",
    condensed: "mb-2",
    cozy: "mb-2.5",
    normal: "mb-3",
    comfortable: "mb-4",
    roomy: "mb-5",
    spacious: "mb-6",
    wide: "mb-8",
    section: "mb-12",
    auto: "mb-auto",
  },
  marginLeft: {
    none: "ml-0",
    hair: "ml-0.5",
    tight: "ml-1",
    snug: "ml-1.5",
    condensed: "ml-2",
    cozy: "ml-2.5",
    normal: "ml-3",
    comfortable: "ml-4",
    roomy: "ml-5",
    spacious: "ml-6",
    wide: "ml-8",
    section: "ml-12",
    auto: "ml-auto",
  },
  /** In a row or column, this child alone fills the cross axis. */
  alignSelf: { stretch: "self-stretch" },
  /** Where a button's content sits (the start instead of the center). */
  justifyContent: { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" },
  marginRight: {
    none: "mr-0",
    hair: "mr-0.5",
    tight: "mr-1",
    snug: "mr-1.5",
    condensed: "mr-2",
    cozy: "mr-2.5",
    normal: "mr-3",
    comfortable: "mr-4",
    roomy: "mr-5",
    spacious: "mr-6",
    wide: "mr-8",
    section: "mr-12",
    auto: "mr-auto",
  },
  /** Children of a block spaced apart by margins (use Stack/Inline when the parent can be a flex row or column). */
  spaceY: {
    none: "space-y-0",
    hair: "space-y-0.5",
    tight: "space-y-1",
    snug: "space-y-1.5",
    condensed: "space-y-2",
    cozy: "space-y-2.5",
    normal: "space-y-3",
    comfortable: "space-y-4",
    roomy: "space-y-5",
    spacious: "space-y-6",
    wide: "space-y-8",
    section: "space-y-12",
  },
  background: {
    page: "bg-page",
    sunken: "bg-sunken",
    panel: "bg-panel",
    sidebar: "bg-sidebar",
    surface: "bg-surface",
    overlay: "bg-overlay",
    transparent: "bg-transparent",
    /** A tint of the meaning color behind a notice bar. */
    dangerSoft: "bg-danger/10",
    warningSoft: "bg-warning/10",
    faint: "bg-sunken/20",
    pageSoft: "bg-page/50",
    /** A faint surface behind a group of suggestions (sunken at 40%), and a row on it (page at 50%). */
    sunkenTint: "bg-sunken/40",
    pageTint: "bg-page/50",
    dangerFaint: "bg-danger/5",
    warningFaint: "bg-warning/5",
    /** The list on the left of a page. */
    navigation: "bg-navigation",
    /** The row that is open or picked, softly. */
    selectedSoft: "bg-selected/60",
  },
  /** A hairline (the theme's border color) on every side, or on one; `none` takes it off. */
  border: {
    all: "border",
    top: "border-t",
    bottom: "border-b",
    left: "border-l",
    right: "border-r",
    none: "border-0",
    /** Takes the line off the bottom only (a tab list inside a bar that has its own). */
    noBottom: "border-b-0",
  },
  /** The color of the hairline (default: the theme border). */
  borderColor: { subtle: "border-subtle", default: "border-default", accent: "border-accent" },
  /** Hairlines between the children of a block. */
  divide: { y: "divide-y" },
  /** `base` is Tailwind's plain `rounded`; sm/md are 6px controls, lg 8px panels. */
  radius: { none: "rounded-none", sm: "rounded-sm", base: "rounded", md: "rounded-md", lg: "rounded-lg", full: "rounded-full" },
  shadow: { xs: "shadow-xs", sm: "shadow-sm", md: "shadow-md" },
  /** `border`: a quiet outline (message bubbles); `focus`: the drop-target outline. */
  ring: { line: "ring-1 ring-line", focus: "ring-2 ring-focus" },
  /**
   * Sizes are named by use; the values are theme variables in tokens/system.css (`--width-*`, `--max-width-*`, `--height-*`, `--max-height-*`,
   * `--min-height-*`), so a number or a length never appears here. Fractions are shares of the parent.
   * `field*`: a control or a name column in a row (`field` 7rem, `-3xs` 3.5rem to `-2xl` 11rem); `menu*` / `popover*`: a dropdown or a
   * floating surface (`menu-2xs` 9rem to `menu-xl` 16rem); `list`: a side list; `card`: a text card; `icon`: a 1rem slot.
   */
  width: {
    full: "w-full", "1/3": "w-1/3", "1/2": "w-1/2", "2/3": "w-2/3", "3/4": "w-3/4",
    icon: "w-icon",
    "field-3xs": "w-field-3xs", "field-2xs": "w-field-2xs", "field-xs": "w-field-xs", "field-sm": "w-field-sm", field: "w-field",
    "field-md": "w-field-md", "field-lg": "w-field-lg", "field-xl": "w-field-xl", "field-2xl": "w-field-2xl",
    "menu-2xs": "w-menu-2xs", "menu-xs": "w-menu-xs", "menu-sm": "w-menu-sm", "menu-md": "w-menu-md", menu: "w-menu", "menu-lg": "w-menu-lg", "menu-xl": "w-menu-xl",
    "popover-sm": "w-popover-sm", popover: "w-popover", "popover-lg": "w-popover-lg",
    list: "w-list", card: "w-card",
  },
  /** `reading` is a page's text column; `label*` cap a truncated name. */
  maxWidth: { full: "max-w-full", reading: "max-w-reading", form: "max-w-form", column: "max-w-column", "label-sm": "max-w-label-sm", label: "max-w-label", "label-lg": "max-w-label-lg" },
  /** `field-2xs`: a label column that may grow but never below 4rem. */
  minWidth: { 0: "min-w-0", "field-2xs": "min-w-field-2xs" },
  /** `bar` is a pane header; `dialog` / `dialog-lg`: a dialog that shows one thing large (75vh / 85vh); `control*` the height of a small / normal control; `track` a thin progress bar; `placeholder*` a loading block. */
  height: {
    full: "h-full", auto: "h-auto", bar: "h-bar", icon: "h-icon", track: "h-track", "control-xs": "h-control-xs", "control-sm": "h-control-sm", control: "h-control",
    "placeholder-sm": "h-placeholder-sm", "placeholder-block": "h-placeholder-block", placeholder: "h-placeholder", "placeholder-md": "h-placeholder-md", "placeholder-lg": "h-placeholder-lg", "placeholder-xl": "h-placeholder-xl", "placeholder-page": "h-placeholder-page",
    dialog: "h-dialog", "dialog-lg": "h-dialog-lg",
  },
  /** A scrolling area's limit (pair with `overflow`): `scroll*` from 8rem to 24rem; `pane` 45% of the parent; `popover` 60vh; `popover-tall` 80vh; `window` the window less a 2rem margin; `dialog` 70svh; `overlay` 70% of the parent. */
  maxHeight: {
    "scroll-xs": "max-h-scroll-xs", "scroll-sm": "max-h-scroll-sm", "scroll-md": "max-h-scroll-md", scroll: "max-h-scroll",
    "scroll-list": "max-h-scroll-list", "scroll-lg": "max-h-scroll-lg", "scroll-xl": "max-h-scroll-xl", "scroll-2xl": "max-h-scroll-2xl", "scroll-3xl": "max-h-scroll-3xl",
    pane: "max-h-pane", popover: "max-h-popover", "popover-tall": "max-h-popover-tall", window: "max-h-window", dialog: "max-h-dialog", overlay: "max-h-overlay",
  },
  /** `0` lets a flex child shrink below its content; `control-sm` a small control's height; `textarea*` a text box's smallest height. */
  minHeight: {
    0: "min-h-0", "control-sm": "min-h-control-sm",
    "textarea-xs": "min-h-textarea-xs", "textarea-sm": "min-h-textarea-sm", "textarea-md": "min-h-textarea-md", textarea: "min-h-textarea", "textarea-lg": "min-h-textarea-lg", "textarea-xl": "min-h-textarea-xl",
  },
  /** A text box that grows with its text; or that cannot be resized by hand. */
  fieldSizing: { content: "field-sizing-content" },
  resize: { none: "resize-none" },
  grow: { true: "flex-1" },
  shrink: { false: "shrink-0", true: "shrink" },
  overflow: { auto: "overflow-auto", hidden: "overflow-hidden", hiddenX: "overflow-x-hidden", x: "overflow-x-auto", y: "overflow-y-auto" },
  position: { relative: "relative" },
  /** `desktop`: shown only on a wide window (xl), hidden below. */
  display: { block: "block", flex: "flex", grid: "grid", desktop: "hidden xl:block" },
  cursor: { pointer: "cursor-pointer" },

  /** The type scale (tokens/system.css): micro 12px, caption 12.5px, body 13.5px, reading 15px, title, heading; label is body, medium. */
  variant: {
    micro: "text-2xs",
    caption: "text-xs",
    body: "text-sm",
    reading: "text-base",
    title: "text-lg",
    heading: "text-xl",
    label: "text-sm font-medium",
    /** The heading roles (Heading): the page's title, a section of a page, a section of a pane, a group inside a section. */
    page: "text-base font-semibold tracking-tight text-default",
    "page-section": "text-base font-semibold text-default",
    section: "text-sm font-semibold text-default",
    group: "text-xs font-semibold text-default",
  },
  /** Color by meaning (semantic tokens only). */
  tone: {
    default: "text-default",
    muted: "text-muted",
    subtle: "text-subtle",
    accent: "text-accent",
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
    inherit: "",
    choice: "text-graph-choice",
  },
  weight: { normal: "font-normal", medium: "font-medium", semibold: "font-semibold" },
  mono: { true: "font-mono" },
  /** Figures that keep their width (counts, times). */
  tabular: { true: "tabular-nums" },
  truncate: { true: "truncate" },
  /** At most this many lines, then an ellipsis. */
  lines: { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" },
  leading: { relaxed: "leading-relaxed", snug: "leading-snug" },
  lineThrough: { true: "line-through" },
  /** `offset`: underlined, a little below the text; `hover`: underlined under the pointer (a link). */
  underline: { true: "underline", offset: "underline underline-offset-2", hover: "hover:underline", hoverOffset: "underline-offset-2 hover:underline" },
  /** Keeps the text's own line breaks. */
  preserveLines: { true: "whitespace-pre-wrap" },
  /** `true` breaks at word edges first; `all` anywhere (a long key or path). */
  breakWords: { true: "break-words", all: "break-all" },
  nowrap: { true: "whitespace-nowrap" },
  textAlign: { start: "text-left", center: "text-center", end: "text-right" },
  opacity: { 0: "opacity-0", 50: "opacity-50", 60: "opacity-60", 100: "opacity-100" },
  userSelect: { none: "select-none" },
  srOnly: { true: "sr-only" },
} as const

export const styleVariants = cva("", { variants: STYLE })

export type StyleProps = VariantProps<typeof styleVariants>

const STYLE_KEYS = Object.keys(STYLE) as (keyof StyleProps)[]

/** Splits the style options from the rest of a component's props. Every option of `STYLE` is taken, so a new one needs no second list. */
export function splitStyle<P extends StyleProps>(props: P): [StyleProps, Omit<P, keyof StyleProps>] {
  const style: Record<string, unknown> = {}
  const rest: Record<string, unknown> = { ...props }
  for (const key of STYLE_KEYS) {
    style[key] = rest[key]
    delete rest[key]
  }
  return [style as StyleProps, rest as Omit<P, keyof StyleProps>]
}
