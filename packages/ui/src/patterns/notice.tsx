import type * as React from "react"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { Inline, Stack } from "../primitives/stack"
import { Text } from "../primitives/text"

type NoticeTone = "neutral" | "warning" | "danger"

/** A box with a fill and a hairline in the tone's color; `inline` ones hold what the notice is about. */
const INLINE: Record<NoticeTone, string> = {
  /** A box for what waits for a decision, holding a stack of things. */
  neutral: "space-y-1.5 rounded-md border border-default bg-sunken/40 p-2.5",
  warning: "rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning",
  /** One failure message. */
  danger: "rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger",
}

/** A row above a form: what happened, and the choices that settle it. */
const BANNER: Record<NoticeTone, { box: string; text: "default" | "warning" | "danger" }> = {
  neutral: { box: "border-default bg-sunken/40", text: "default" },
  warning: { box: "border-warning/40 bg-warning/5", text: "warning" },
  danger: { box: "border-danger/30 bg-danger/5", text: "danger" },
}

/** The alert layout (a notice with an icon and a title): the icon sits in the first column, the text beside it. */
const TITLED =
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current"
const TITLED_TONE: Record<NoticeTone, string> = {
  neutral: "bg-surface text-default",
  warning: "bg-surface text-warning *:data-[slot=alert-description]:text-warning/90",
  danger: "bg-surface text-danger *:data-[slot=alert-description]:text-danger/90",
}

/** A small pill that floats: `window` at the bottom of the window (quiet, default text), `canvas` at the top middle of a canvas (it never takes a click). */
const FLOATING = {
  window: "fixed bottom-10 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-overlay px-3 py-1.5 text-xs text-default shadow-md",
  canvas: "pointer-events-none absolute top-14 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-overlay px-3 py-1.5 text-xs text-muted shadow-sm",
} as const

export type NoticeProps = Omit<React.HTMLAttributes<HTMLElement>, "className" | "title"> & {
  tone?: NoticeTone
  /** `inline` sits in the flow; `banner` is a wrapping row with `actions` at its end; `floating` hovers over the screen at `placement`. */
  variant?: "inline" | "banner" | "floating"
  /** The tag of an `inline` notice without a title (a single message is a `p`). */
  as?: "div" | "p"
  /** `floating` only. */
  placement?: keyof typeof FLOATING
  /** `banner` only: the choices that settle it, at the row's end. */
  actions?: ReactNode
  /** `inline` only: an icon and a title put the notice in the alert layout; give the text as `NoticeDescription`, controls as `NoticeRow`. */
  icon?: ReactNode
  title?: ReactNode
}

/** A message that is not part of the content: a failure, a warning, what waits for a decision, a status that floats. */
export function Notice({ tone = "neutral", variant = "inline", as: Tag = "div", placement = "window", actions, icon, title, children, ...props }: NoticeProps) {
  if (variant === "floating")
    return <div className={FLOATING[placement]} {...props}>{children}</div>
  if (variant === "banner") {
    const banner = BANNER[tone]
    return (
      <div className={cn("flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs", banner.box)} {...props}>
        <Text tone={banner.text}>{children}</Text>
        <Stack as="span" direction="row" gap="tight" marginLeft="auto">
          {actions}
        </Stack>
      </div>
    )
  }
  if (icon != null || title != null)
    return (
      <div data-slot="alert" role="alert" className={cn(TITLED, TITLED_TONE[tone])} {...props}>
        {icon}
        {title != null && (
          <div data-slot="alert-title" className="col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight">
            {title}
          </div>
        )}
        {children}
      </div>
    )
  return <Tag className={INLINE[tone]} {...props}>{children}</Tag>
}

/** The text of a titled notice, under the title. */
export function NoticeDescription({ children }: { children?: ReactNode }) {
  return (
    <div data-slot="alert-description" className="col-start-2 grid justify-items-start gap-1 text-sm text-muted [&_p]:leading-relaxed">
      {children}
    </div>
  )
}

/** A row of controls under a titled notice's text (fields, a button): an `Inline` that starts in the text column, beside the icon like the title and description. */
export function NoticeRow(props: Omit<React.ComponentProps<typeof Inline>, "className">) {
  return <Inline className="col-start-2" {...props} />
}
