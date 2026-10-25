import { Slot } from "@radix-ui/react-slot"
import { clsx } from "clsx"
import type * as React from "react"
import { type StyleProps, splitStyle, styleVariants } from "./style"
import type { ElementTag } from "./tags"

type TextVariant = "micro" | "caption" | "body" | "reading" | "title" | "heading" | "label"
type HeadingVariant = "page" | "page-section" | "section" | "group"

export type TextProps = React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> } & Omit<StyleProps, "variant"> & {
  as?: ElementTag
  /** Puts the options on the one child instead of rendering an element (a router link). */
  asChild?: boolean
  /** The type scale: size and line height (label adds weight). With none the text keeps the size around it. */
  variant?: TextVariant
  /** Alignment of the text itself (`textAlign`). */
  align?: StyleProps["textAlign"]
  htmlFor?: string
}

/**
 * Text in a role of the type scale, colored by meaning. It adds only what is named: `<Text tone="muted">` changes the color and nothing
 * else. Layout options (padding, margin, display, overflow...) are accepted too, for a line that needs them.
 */
export function Text({ as: Tag = "span", asChild, variant, align, className, ...props }: TextProps) {
  const [style, rest] = splitStyle(props)
  const Element = (asChild ? Slot : Tag) as React.ElementType
  return <Element className={clsx(styleVariants({ ...style, variant, textAlign: align ?? style.textAlign }), className) || undefined} {...rest} />
}

export type HeadingProps = Omit<TextProps, "variant" | "as"> & {
  as?: "h1" | "h2" | "h3" | "h4" | "legend"
  /**
   * page: the page's title (text-base, semibold, tight tracking); page-section: a section of a full page such as the project home
   * (text-base); section: a section of a pane or dialog (text-sm); group: a group inside a section (text-xs). All semibold, foreground.
   */
  variant?: HeadingVariant
}

/** A heading in one of the heading roles (`SectionHeading`, `GroupHeading` and `PageTitle` are thin wrappers of these). */
export function Heading({ as: Tag = "h2", variant = "section", ...props }: HeadingProps) {
  return <Text as={Tag} {...props} variant={variant as never} />
}
