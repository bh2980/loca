import { AlertCircle, Check, LoaderCircle } from "lucide-react"
import type * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { Button } from "../primitives/button"
import { Skeleton } from "../primitives/skeleton"
import { Tabs, TabsList } from "../primitives/tabs"

/** Underlines and highlights the one link inside it (a quiet link in a line of text). The link keeps its own element. */
export function LinkStyle({ children }: { children: React.ReactElement }) {
  return <Slot className="underline underline-offset-2 hover:text-foreground">{children}</Slot>
}

/**
 * The line under an auto-saving form: nothing, "저장 중", "저장했습니다" or "저장하지 못했습니다" with a retry. Announced politely, and a
 * failure assertively.
 */
export function SaveStatusLine({ status, onRetry }: { status: "idle" | "saving" | "saved" | "failed"; onRetry?: () => void }) {
  const failed = status === "failed"
  return (
    <div role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
      {status === "saving" && <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> 저장 중</>}
      {status === "saved" && <><Check aria-hidden="true" className="size-3.5 text-success" /> 저장했습니다</>}
      {failed && <><AlertCircle aria-hidden="true" className="size-3.5 text-destructive" /> 저장하지 못했습니다 {onRetry && <Button variant="ghost" onClick={onRetry}>다시 시도</Button>}</>}
    </div>
  )
}

/** The placeholder of a settings page while its project loads: a title bar and the first block (`editor` is wider and taller). */
export function SettingsPageSkeleton({ shape }: { shape: "editor" | "project" }) {
  return shape === "editor" ? (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  ) : (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-20" />
    </div>
  )
}

/** Tabs that sit in a page header and are as tall as it. */
export function HeaderTabs(props: React.ComponentProps<typeof Tabs>) {
  return <Tabs className="self-stretch" {...props} />
}

/** The tab list of `HeaderTabs`: underlined tabs filling the header's height, with no rule of its own. */
export function HeaderTabsList(props: Omit<React.ComponentProps<typeof TabsList>, "variant">) {
  return <TabsList variant="line" className="h-full border-b-0" {...props} />
}
