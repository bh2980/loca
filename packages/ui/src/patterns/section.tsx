import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "../controls/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"
import { Box } from "../primitives/box"
import { type STYLE } from "../primitives/style"
import { Inline } from "../primitives/stack"
import { Heading } from "../primitives/text"
import { cn } from "../lib/utils"

/**
 * The type hierarchy of panes, pages and dialogs, one role per level, so nested information reads as nested:
 * 1. A section of a page or pane (`Section`, `SectionHeading level="section"`: text-sm, semibold; `page` is one step above, text-base).
 * 2. A group inside a section (`Group`, `SectionHeading level="group"`: text-xs, semibold).
 * 3. Row labels (`KeyValue`): text-xs, regular, muted.
 * Content under them is text-sm foreground; counts, keys, times and evidence are text-xs muted.
 * Screens use these parts instead of styling h2/h3/h4/legend themselves (pnpm ui-rules).
 */

interface PaneSectionProps {
  variant?: "pane"
  /** Without a title the section is a plain block with the same inset and divider. */
  title?: ReactNode
  children?: ReactNode
  /** At the right of the title row. */
  actions?: ReactNode
  /** Given, the section folds and starts open or closed; without it the section is plain (most are). */
  defaultOpen?: boolean
  /** Fold even without a default (rarely needed: pass defaultOpen instead). */
  collapsible?: boolean
  id?: string
  /** Keeps its height in a column that scrolls (it never shrinks). */
  noShrink?: boolean
}

interface PageSectionProps {
  variant: "page"
  title: ReactNode
  description?: ReactNode
  /** At the right of the title row (e.g. counts, add buttons). */
  actions?: ReactNode
  /** The block's save / revert buttons, under its content. */
  footer?: ReactNode
  /** `danger` is the danger zone: a destructive-bordered box at the end of the page. */
  tone?: "default" | "danger"
  children?: ReactNode
}

export type SectionProps = PaneSectionProps | PageSectionProps

/**
 * A titled part of a pane, or (`variant="page"`) a titled block of a settings page. They render differently and share only the name:
 * - pane (default): plain, divided from the next by a hairline. A pane is a few sections the eye reads top to bottom, and a chevron on
 *   each one is noise; only long or occasional parts fold (문맥, 고급, 프롬프트, 이력): give them `defaultOpen`.
 * - page: blocks stack in a column; the save rule is one for all: controls that take effect at once (switches, selects) save on change,
 *   with a toast; typed fields (names, rules) save with the block's own 저장 button in `footer`, enabled only when something changed,
 *   with 되돌리기 beside it.
 */
export function Section(props: SectionProps) {
  if (props.variant === "page") return <PageSection {...props} />
  return <PaneSection {...props} />
}

const PANE_BLOCK = "scroll-mt-4 border-b border-subtle px-4 py-3"

function PaneSection({ title, children, actions, defaultOpen, collapsible, id, noShrink }: PaneSectionProps) {
  const extra = noShrink && "shrink-0"
  if (title === undefined)
    return (
      <section id={id} className={cn(PANE_BLOCK, extra)}>
        {children}
      </section>
    )
  const folds = collapsible ?? defaultOpen !== undefined
  if (!folds)
    return (
      <section id={id} className={cn(PANE_BLOCK, "space-y-3", extra)}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-default">{title}</h3>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        {children}
      </section>
    )
  return (
    <Collapsible defaultOpen={defaultOpen ?? true} asChild>
      <section id={id} className={cn(PANE_BLOCK, "space-y-3", extra)}>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group -ml-1 h-7 min-w-0 flex-1 justify-start gap-1 px-1 text-sm font-semibold text-default hover:bg-hover/50"
            >
              <ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=closed]:-rotate-90" />
              <span className="truncate">{title}</span>
            </Button>
          </CollapsibleTrigger>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent className="space-y-3">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function PageSection({ title, description, actions, footer, tone = "default", children }: PageSectionProps) {
  const danger = tone === "danger"
  return (
    <section className={danger ? "space-y-3 rounded-lg border border-danger/30 p-4" : "space-y-4"}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className={cn("text-base font-semibold", danger && "text-danger")}>{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
      {footer && <div className="flex items-center gap-2">{footer}</div>}
    </section>
  )
}

/**
 * A heading in one of the three levels (`level`: `page` text-base for a section of a full page such as the project home, `section`,
 * `group`), with `actions` at its right. `ruled` puts a hairline under it (the head of a popover); `marginBottom` is the space below.
 */
export function SectionHeading({ children, actions, level = "section", as, ruled, marginBottom }: {
  children: ReactNode
  actions?: ReactNode
  level?: "page" | "section" | "group"
  as?: "h1" | "h2" | "h3" | "h4" | "legend"
  ruled?: boolean
  marginBottom?: keyof typeof STYLE.marginBottom
}) {
  const spacing = { border: ruled ? ("bottom" as const) : undefined, paddingBottom: ruled ? ("condensed" as const) : undefined, marginBottom }
  const heading = (
    <Heading as={as ?? (level === "group" ? "h3" : "h2")} variant={level === "page" ? "page-section" : level} minWidth={0} {...(actions ? {} : spacing)}>
      {children}
    </Heading>
  )
  if (!actions) return heading
  return (
    <Inline justify="between" gap="condensed" minWidth={0} {...spacing}>
      {heading}
      <Inline shrink={false} gap="tight">{actions}</Inline>
    </Inline>
  )
}

/** A titled group inside a section: its heading, then its content (text-sm), `spaceY` apart. */
export function Group({ title, actions, spaceY = "condensed", children }: { title: ReactNode; actions?: ReactNode; spaceY?: keyof typeof STYLE.spaceY; children?: ReactNode }) {
  return (
    <Box as="section" minWidth={0} spaceY={spaceY} variant="body">
      <SectionHeading level="group" actions={actions}>{title}</SectionHeading>
      {children}
    </Box>
  )
}
