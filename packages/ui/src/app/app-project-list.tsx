import { Slot } from "@radix-ui/react-slot"
import { Languages } from "lucide-react"
import type * as React from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "../primitives/card"
import { Empty } from "../primitives/empty"
import { Skeleton } from "../primitives/skeleton"

/** The project list page's column: centered, at most 56rem wide, as tall as the window. */
export function ProjectListFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-6 py-12">{children}</div>
}

/** The app's mark beside its name. */
export function BrandMark() {
  return (
    <div className="flex size-8 items-center justify-center rounded-xs bg-primary text-primary-foreground">
      <Languages className="size-4" />
    </div>
  )
}

/** The project cards, two to a row once the window is wide enough. */
export function ProjectGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

/** A project card while the list loads. */
export function ProjectCardSkeleton() {
  return <Skeleton className="h-24" />
}

/** An empty state drawn inside a hairline frame. */
export function OutlinedEmpty(props: React.ComponentProps<typeof Empty>) {
  return <Empty className="border" {...props} />
}

/** Makes the one link inside it a focusable card target (rounded, with a focus ring); the card is its child. */
export function ProjectCardLink({ children }: { children: React.ReactNode }) {
  return <Slot className="rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">{children}</Slot>
}

/** A project in the list: its name, language pair and line count. */
export function ProjectCard({ name, sourceLanguage, targetLanguage, units }: { name: string; sourceLanguage: string; targetLanguage: string; units: number }) {
  return (
    <Card className="h-full border-border shadow-none transition-colors hover:bg-muted hover:border-border">
      <CardHeader className="p-4">
        <CardTitle className="truncate text-sm font-semibold">{name}</CardTitle>
        <CardDescription className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="uppercase font-mono">{sourceLanguage}</span>→<span className="uppercase font-mono">{targetLanguage}</span>
          <span>·</span>
          <span className="tabular-nums">대사 {units.toLocaleString()}개</span>
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
