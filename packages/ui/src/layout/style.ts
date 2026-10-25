import { cva, type VariantProps } from "class-variance-authority"

/**
 * The options every layout and text part shares (Box, Stack, Inline, Grid, Text, Heading, Icon and the layout options of Button), by token
 * name. A screen arranges and styles with these and never writes a class; anything they cannot say belongs in a component of its own
 * (packages/ui). Every value is written out in full so Tailwind finds each class in this file.
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
    pixel: "pt-px",
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
    "-tight": "-mt-1",
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
    "-tight": "-mb-1",
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
    /** Pulled out past the parent's padding (a ghost button whose text lines up with its neighbours). */
    "-tight": "-ml-1",
    "-condensed": "-ml-2",
  },
  marginX: { tight: "mx-1", "-tight": "-mx-1", "-snug": "-mx-1.5", "-condensed": "-mx-2" },
  /** Children with no padding on the first top and the last bottom (rows of a divided list). */
  trimEnds: { true: "first:pt-0 last:pb-0" },
  group: { true: "group" },
  hoverUnderline: { true: "hover:underline" },
  alignSelf: { stretch: "self-stretch" },
  /** A button's content from the start instead of the center. */
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
    background: "bg-background",
    muted: "bg-muted",
    panel: "bg-panel",
    sidebar: "bg-sidebar",
    card: "bg-card",
    popover: "bg-popover",
    transparent: "bg-transparent",
    /** A tint of the meaning color behind a notice bar. */
    destructiveSoft: "bg-destructive/10",
    warningSoft: "bg-warning/10",
    faint: "bg-muted/20",
    destructiveFaint: "bg-destructive/5",
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
  borderColor: { subtle: "border-border-subtle", border: "border-border", select: "border-[color:var(--graph-select)]" },
  /** Hairlines between the children of a block. */
  divide: { y: "divide-y" },
  /** `base` is Tailwind's plain `rounded`; sm/md are 6px controls, lg 8px panels. */
  radius: { none: "rounded-none", sm: "rounded-sm", base: "rounded", md: "rounded-md", lg: "rounded-lg", full: "rounded-full" },
  shadow: { xs: "shadow-xs", sm: "shadow-sm", md: "shadow-md" },
  /** `border`: a quiet outline (message bubbles); `focus`: the drop-target outline. */
  ring: { border: "ring-1 ring-border", focus: "ring-2 ring-ring" },
  /** Fixed widths are Tailwind steps (`28` is 7rem), fractions of the parent, or `200px` (a side list's width). */
  width: {
    full: "w-full", fit: "w-fit", auto: "w-auto",
    "1/2": "w-1/2", "2/3": "w-2/3", "3/4": "w-3/4",
    24: "w-24", 32: "w-32", 40: "w-40", 44: "w-44", 48: "w-48", 56: "w-56", 60: "w-60", 64: "w-64", 80: "w-80",
    4: "w-4",
    14: "w-14",
    16: "w-16",
    20: "w-20",
    28: "w-28",
    36: "w-36",
    "200px": "w-[200px]",
    72: "w-72", 96: "w-96",
    "26rem": "w-[26rem]",
  },
  maxWidth: { full: "max-w-full", "4xl": "max-w-4xl", "3xl": "max-w-3xl", 48: "max-w-48", "200px": "max-w-[200px]", "140px": "max-w-[140px]" },
  minWidth: { 0: "min-w-0" },
  /** `bar` is the 48px height of a pane's header. */
  height: { full: "h-full", auto: "h-auto", bar: "h-12", 7: "h-7", 1.5: "h-1.5", 4: "h-4", 8: "h-8", 16: "h-16", 32: "h-32", 40: "h-40", 96: "h-96", 24: "h-24", 28: "h-28" },
  /** A scrolling area's limit, in Tailwind steps (`56` is 14rem); `pane` is 45% of the parent. Pair with `overflow`. */
  maxHeight: {
    32: "max-h-32",
    40: "max-h-40",
    48: "max-h-48",
    56: "max-h-56",
    64: "max-h-64",
    72: "max-h-72",
    96: "max-h-96",
    80: "max-h-80",
    pane: "max-h-[45%]",
    "60vh": "max-h-[60vh]",
    "70svh": "max-h-[70svh]",
    "70%": "max-h-[70%]",
  },
  /** `0` lets a flex child shrink below its content; `16` is a text box's smallest height. */
  minHeight: { 0: "min-h-0", 7: "min-h-7", 16: "min-h-16", 20: "min-h-20", 28: "min-h-28", 40: "min-h-40", 56: "min-h-56" },
  /** A text box that grows with its text; or that cannot be resized by hand. */
  fieldSizing: { content: "field-sizing-content" },
  resize: { none: "resize-none" },
  grow: { true: "flex-1" },
  shrink: { false: "shrink-0", true: "shrink" },
  overflow: { auto: "overflow-auto", hidden: "overflow-hidden", hiddenX: "overflow-x-hidden", x: "overflow-x-auto", y: "overflow-y-auto" },
  position: { relative: "relative", absolute: "absolute" },
  display: { block: "block", inline: "inline", inlineBlock: "inline-block", flex: "flex", inlineFlex: "inline-flex" },
  cursor: { pointer: "cursor-pointer" },
  /** Centered in a wider parent. */
  centered: { true: "mx-auto" },

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
    page: "text-base font-semibold tracking-tight text-foreground",
    "page-section": "text-base font-semibold text-foreground",
    section: "text-sm font-semibold text-foreground",
    group: "text-xs font-semibold text-foreground",
  },
  /** Color by meaning (semantic tokens only). */
  tone: {
    default: "text-foreground",
    muted: "text-muted-foreground",
    subtle: "text-subtle-foreground",
    primary: "text-primary",
    danger: "text-destructive",
    warning: "text-warning",
    success: "text-success",
    inherit: "",
    choice: "text-choice",
  },
  weight: { normal: "font-normal", medium: "font-medium", semibold: "font-semibold" },
  mono: { true: "font-mono" },
  /** Figures that keep their width (counts, times). */
  tabular: { true: "tabular-nums" },
  truncate: { true: "truncate" },
  /** At most this many lines, then an ellipsis. */
  lines: { 2: "line-clamp-2", 3: "line-clamp-3" },
  leading: { relaxed: "leading-relaxed", snug: "leading-snug" },
  italic: { true: "italic" },
  lineThrough: { true: "line-through" },
  underline: { true: "underline", offset: "underline underline-offset-2" },
  /** Keeps the text's own line breaks. */
  preserveLines: { true: "whitespace-pre-wrap" },
  breakWords: { true: "break-words" },
  nowrap: { true: "whitespace-nowrap" },
  textAlign: { start: "text-left", center: "text-center", end: "text-right" },
  opacity: { 0: "opacity-0", 30: "opacity-30", 50: "opacity-50", 60: "opacity-60", 100: "opacity-100" },
  top: { 0: "top-0" },
  left: { 0: "left-0" },
  userSelect: { none: "select-none" },
  flow: { column: "flex-col" },
  items: { start: "items-start", center: "items-center", end: "items-end", baseline: "items-baseline", stretch: "items-stretch" },
  margin: { comfortable: "m-4" },
  breakAll: { true: "break-all" },
  trimStart: { true: "first:pt-0" },
  maxWidthFromSm: { lg: "sm:max-w-lg", xl: "sm:max-w-xl", "3xl": "sm:max-w-3xl" },
  revealOnHover: { group: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100" },
  inset: { 0: "inset-0" },
  forceHidden: { true: "!pointer-events-none !opacity-0" },
  zIndex: { 20: "z-20", 30: "z-30" },
  /** The column a child of a grid starts in (beside the icon of an Alert: 2). */
  columnStart: { 2: "col-start-2" },
  /** A square of this many Tailwind steps (`2` is 0.5rem): a dot. */
  square: { 2: "size-2" },
  /** `workflow*`: the ports of a workflow node (by tone). */
  flowHandle: { workflow: "!size-2.5 !border-2 !border-card !bg-muted-foreground", workflowWarning: "!size-2.5 !border-2 !border-card !bg-warning", workflowDestructive: "!size-2.5 !border-2 !border-card !bg-destructive", anchor: "!top-1/2 !size-1 !border-0 !opacity-0", port: "!size-2.5 !border-2 !border-card !bg-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:!bg-primary group-hover/person:!bg-primary", event: "!size-3 !border-2 !border-card !bg-muted-foreground after:absolute after:-inset-3 after:content-[''] hover:!bg-primary group-hover/event:!bg-primary", eventIdle: "!opacity-0" },
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
