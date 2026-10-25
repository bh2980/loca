import { Slot } from "@radix-ui/react-slot"
import { ChevronRight } from "lucide-react"
import type * as React from "react"
import { cn } from "../lib/utils"
import { Page, type PageProps } from "../layout/page"
import { Skeleton } from "../primitives/skeleton"
import { StatusBar } from "../tokens/status"

/** A page whose content is a centered reading column (the project home). */
export function ReadingPage(props: PageProps) {
  return <Page {...props} className="mx-auto w-full max-w-5xl space-y-8 py-8" />
}

/** A to-do or run row while the home page loads. */
export function RowSkeleton() {
  return <Skeleton className="h-16" />
}

/** The stacked status meter: `page` is the project home's, `footer` the status bar's small one. */
export function StatusMeter({ variant, ...props }: { variant: "page" | "footer" } & Omit<React.ComponentProps<typeof StatusBar>, "className">) {
  return <StatusBar {...props} className={variant === "page" ? "h-1.5" : "h-1 w-20 shrink-0"} />
}

/** The row's label for a kind of script lines ("대사 · 12줄"), at least 4rem wide so the status links line up. */
export function ProgressKindLabel({ children }: { children: React.ReactNode }) {
  return <span className="min-w-16 text-xs text-muted-foreground">{children}</span>
}

/** Makes the link inside it a status chip (a small rounded target that tints on hover). */
export function StatusChipLink({ children }: { children: React.ReactNode }) {
  return <Slot className="flex items-center gap-1.5 rounded-xs px-2 py-1 text-sm hover:bg-muted transition-colors">{children}</Slot>
}

/** Makes the link inside it a full row of a bordered list (to-dos). */
export function TodoRowLink({ children }: { children: React.ReactNode }) {
  return <Slot className="flex items-center gap-4 px-4 py-3 hover:bg-muted">{children}</Slot>
}

/** Makes the link inside it a run row of a bordered list. */
export function RunRowLink({ children }: { children: React.ReactNode }) {
  return <Slot className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-muted">{children}</Slot>
}

/** The icon tile at the start of a to-do; `alert` tints it as a problem. */
export function TodoIcon({ alert, children }: { alert?: boolean; children: React.ReactNode }) {
  return <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md bg-muted [&_svg]:size-4", alert && "bg-destructive/10 text-destructive")}>{children}</span>
}

/** The quiet arrow at the end of a row that opens something. */
export function RowChevron() {
  return <ChevronRight className="size-4 text-muted-foreground" />
}

/** A run row's name cell (fixed 10rem, one line). */
export function RunTitleCell({ children }: { children: React.ReactNode }) {
  return <span className="w-40 shrink-0 truncate">{children}</span>
}

/** A run row's count (or elapsed time) cell, right-aligned. */
export function RunCountCell({ children }: { children: React.ReactNode }) {
  return <span className="w-24 shrink-0 text-right whitespace-nowrap text-muted-foreground tabular-nums">{children}</span>
}

/** A run row's date cell; only shown on wide screens. */
export function RunDateCell({ children }: { children: React.ReactNode }) {
  return <span className="hidden w-44 shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground xl:block">{children}</span>
}

/** The checklist of the getting-started card, in a hairline frame. */
export function StepList({ children }: { children: React.ReactNode }) {
  return <ol className="rounded-md border border-border bg-background/50">{children}</ol>
}

/** The number (or check) circle of a step: `done`, the `current` one, or still to do. */
export function StepMarker({ state, children }: { state: "done" | "current" | "todo"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
        state === "done" ? "border-success bg-success text-background" : state === "current" ? "border-foreground font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}
