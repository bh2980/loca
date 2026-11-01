import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "../controls/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible"
import { Box } from "../primitives/box"
import { STYLE } from "../primitives/style"
import { Inline } from "../primitives/stack"
import { Heading } from "../primitives/text"
import { cn } from "../lib/utils"
import { useSectionOpen } from "./use-section-open"

/**
 * The type hierarchy of panes, pages and dialogs, one role per level, so nested information reads as nested:
 * 1. A section of a page or pane (`Section`, `SectionHeading level="section"`: text-section 14px, bold; `page` is one step above, text-base).
 * 2. A group inside a section (`Group`, `SectionHeading level="group"`: text-2xs, semibold, muted). A section's own content sits flush
 *    with its header's left edge, never indented; only a genuine second level (`Group nested`) indents, under a subtle rule.
 * 3. Row labels (`KeyValue`): text-xs, regular, muted.
 * Content under them is text-sm foreground; counts, keys, times and evidence are text-xs muted.
 * Screens use these parts instead of styling h2/h3/h4/legend themselves (pnpm ui-rules).
 */

type Fold =
  | { collapsible?: false; persistKey?: never }
  /**
   * The section folds: its title is a band with a chevron, the content flush with the header's left edge. It starts open; `persistKey` (required)
   * names where it is (`line.history`), and what a person folds stays folded for every item of that kind (useSectionOpen).
   */
  | { collapsible: true; persistKey: string }

type PaneSectionProps = Fold & {
  variant?: "pane"
  /** Without a title the section is a plain block with the same inset and divider. */
  title?: ReactNode
  /** Beside the title, quieter (how many items, how many are on). */
  count?: ReactNode
  children?: ReactNode
  /** At the right of the title row. */
  actions?: ReactNode
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
 * - pane (default): its title (14px bold) over the content, a line (border-default) to the next. `collapsible` sections (long or
 *   occasional parts: 문맥, 고급, 이력 …) have a header band with a chevron, a strong line under it, and their content flush with the
 *   header's left edge (the band and line already mark the level; an indent would only spend width). They start open and remember what
 *   a person folded (`persistKey`). Nothing starts folded. A second level inside a section is `Group nested`.
 * - page: blocks stack in a column; the save rule is one for all: controls that take effect at once (switches, selects) save on change,
 *   with a toast; typed fields (names, rules) save with the block's own 저장 button in `footer`, enabled only when something changed,
 *   with 되돌리기 beside it.
 */
export function Section(props: SectionProps) {
  if (props.variant === "page") return <PageSection {...props} />
  if (props.collapsible && props.title !== undefined) return <FoldingSection {...props} />
  return <PaneSection {...props} />
}

const LINE = "scroll-mt-4 border-b border-default"

const Title = ({ title, count }: { title: ReactNode; count?: ReactNode }) => (
  <>
    <span className="truncate">{title}</span>
    {count != null && count !== "" && <span className="shrink-0 font-medium text-subtle">{count}</span>}
  </>
)

function PaneSection({ title, count, children, actions, id, noShrink }: PaneSectionProps) {
  const extra = noShrink && "shrink-0"
  if (title === undefined)
    return (
      <section id={id} className={cn(LINE, "space-y-3 px-4 py-4", extra)}>
        {children}
      </section>
    )
  return (
    <section id={id} className={cn(LINE, "space-y-3 px-4 pt-4 pb-5", extra)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-baseline gap-1 text-section font-bold text-default">
          <Title title={title} count={count} />
        </h3>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

function FoldingSection({ title, count, children, actions, id, noShrink, persistKey }: PaneSectionProps & { collapsible: true; persistKey: string }) {
  const [open, setOpen] = useSectionOpen(persistKey)
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section id={id} className={cn(LINE, "group/section", noShrink && "shrink-0")}>
        <div className="flex min-h-10 items-center justify-between gap-2 border-default bg-band px-4 group-data-[state=open]/section:border-b">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group -ml-1.5 h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 text-section font-bold text-default hover:bg-hover/60"
            >
              <ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-data-[state=closed]:-rotate-90" />
              <Title title={title} count={count} />
            </Button>
          </CollapsibleTrigger>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent className="min-w-0 space-y-3 px-4 pt-3 pb-4">{children}</CollapsibleContent>
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

/**
 * A titled group inside a section: its heading, then its content (text-sm), `spaceY` apart. `nested` is for a genuine second level
 * (검증's 지적 / 말투 / 용어 / 형식): the content indents under a subtle rule below its heading. A section's own content never indents.
 * `collapsible` makes the heading fold the group with the same chevron as a folding section, at the group's size (a run step's
 * 보낸 프롬프트, a plan's 묶음, a chat tool call's output): open at first, and what a person folds stays folded (`persistKey`).
 */
export function Group({ title, count, actions, spaceY = "condensed", nested, collapsible, persistKey, children }: {
  title: ReactNode
  /** Beside the title, quieter. */
  count?: ReactNode
  actions?: ReactNode
  spaceY?: keyof typeof STYLE.spaceY
  nested?: boolean
  children?: ReactNode
} & Fold) {
  const body = nested ? <div className={cn("min-w-0 border-l-2 border-subtle pl-3", STYLE.spaceY[spaceY])}>{children}</div> : children
  if (collapsible) return <FoldingGroup title={title} count={count} actions={actions} spaceY={spaceY} persistKey={persistKey}>{body}</FoldingGroup>
  return (
    <Box as="section" minWidth={0} spaceY={spaceY} variant="body">
      <SectionHeading level="group" actions={actions}>{count != null && count !== "" ? <Inline as="span" gap="tight"><Title title={title} count={count} /></Inline> : title}</SectionHeading>
      {body}
    </Box>
  )
}

function FoldingGroup({ title, count, actions, spaceY, persistKey, children }: { title: ReactNode; count?: ReactNode; actions?: ReactNode; spaceY: keyof typeof STYLE.spaceY; persistKey: string; children?: ReactNode }) {
  const [open, setOpen] = useSectionOpen(persistKey)
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className={cn("min-w-0 text-sm", STYLE.spaceY[spaceY])}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="group -ml-1.5 h-7 min-w-0 justify-start gap-1.5 px-1.5 text-2xs font-semibold text-muted hover:bg-hover/60 hover:text-default">
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
              <Title title={title} count={count} />
            </Button>
          </CollapsibleTrigger>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
        <CollapsibleContent className={cn("min-w-0", STYLE.spaceY[spaceY])}>{children}</CollapsibleContent>
      </section>
    </Collapsible>
  )
}
