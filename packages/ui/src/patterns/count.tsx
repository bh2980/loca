import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { Chip } from "./chip"

export type CountProps = {
  /** `neutral`: a quiet pill; `accent`: a filled one (what waits for you); `warning`: a mono figure tinted as something to look at. */
  tone?: "neutral" | "accent" | "warning"
  children?: ReactNode
}

/** A parent `Box asChild` hands its options over as `className`; it is not part of the public props. */
type FromSlot = { className?: string }

/** A number (or "N건 대기") on a small pill, one text size. */
export function Count({ tone = "neutral", className, ...props }: CountProps & FromSlot) {
  if (tone === "warning") return <span className={cn("shrink-0 rounded-sm bg-warning/15 px-1 py-0.5 text-xs font-mono text-warning tabular-nums", className)} {...props} />
  return <Chip variant={tone === "accent" ? "solid" : "quiet"} {...props} {...({ className } as FromSlot)} />
}
