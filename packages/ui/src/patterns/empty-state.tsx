import type * as React from "react"
import type { ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

function subject(noun: string) {
  const code = noun.trim().charCodeAt(noun.trim().length - 1) - 0xac00
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가"
}

const FRAME = {
  /** A dashed frame that takes the room of its pane. */
  pane: "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-default bg-page/50 p-6 text-center text-balance md:p-12",
  /** The same, centered in the whole window (an error that replaces a page). */
  page: "flex min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-default bg-page/50 p-6 text-center text-balance md:p-12 m-auto min-h-svh",
} as const

const INLINE = {
  default: "flex flex-col items-center justify-center px-4 py-12 text-center text-xs text-muted",
  /** Roomier, for a list that has nothing to show. */
  roomy: "flex flex-col items-center justify-center px-4 py-12 text-center text-xs text-muted",
} as const

export type EmptyStateProps =
  | {
      /** `inline` is a line of text with room around it (a table or list with nothing in it); it says "아직 {noun}이 없습니다" or, `filtered`, "조건에 맞는 {noun}이 없습니다". */
      size?: "inline"
      noun: string
      filtered?: boolean
      hint?: ReactNode
      action?: ReactNode
      variant?: keyof typeof INLINE
    }
  | (Omit<React.ComponentProps<"div">, "className"> & {
      /** `pane` is a dashed frame filling its pane, built from `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`; `page` centers it in the window. */
      size: "pane" | "page"
      /** Laid over the whole positioned parent (a canvas) instead of taking room in its flow. */
      overlay?: boolean
      noun?: undefined
    })

/** What is shown where there is nothing to show yet. */
export function EmptyState(props: EmptyStateProps) {
  if (props.noun === undefined) {
    const { size = "pane", overlay, ...rest } = props as Omit<React.ComponentProps<"div">, "className"> & { size?: "pane" | "page"; overlay?: boolean }
    return <div data-slot="empty" {...rest} className={cn(FRAME[size], overlay && "absolute inset-0")} />
  }
  const { noun, filtered, hint, action, variant = "default" } = props
  const particle = subject(noun)
  return (
    <div className={INLINE[variant]}>
      <p className={cn("text-xs", !filtered && hint ? "font-medium text-default" : undefined)}>
        {filtered ? `조건에 맞는 ${noun}${particle} 없습니다.` : `아직 ${noun}${particle} 없습니다.`}
      </p>
      {!filtered && hint && <p className="mt-1 text-subtle">{hint}</p>}
      {!filtered && action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}

export function EmptyHeader(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div data-slot="empty-header" className="flex max-w-sm flex-col items-center gap-2 text-center" {...props} />
}

const emptyMediaVariants = cva("mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "bg-transparent",
      icon: "flex size-9 shrink-0 items-center justify-center rounded-xs bg-sunken text-default [&_svg:not([class*='size-'])]:size-5",
    },
  },
  defaultVariants: { variant: "default" },
})

export function EmptyMedia({ variant = "default", ...props }: Omit<React.ComponentProps<"div">, "className"> & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" data-variant={variant} className={emptyMediaVariants({ variant })} {...props} />
}

export function EmptyTitle(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div data-slot="empty-title" className="text-base font-semibold text-default" {...props} />
}

export function EmptyDescription(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div data-slot="empty-description" className="text-sm/relaxed text-muted [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-accent" {...props} />
}

export function EmptyContent(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div data-slot="empty-content" className="flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance" {...props} />
}
