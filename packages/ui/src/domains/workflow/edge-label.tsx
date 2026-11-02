import type * as React from "react"
import { clsx } from "clsx"

const PILL = "rounded-sm border border-default bg-surface px-1 py-0.5 text-xs leading-4 text-default shadow-2xs"

/** The row laid over a workflow line where the layout left room: the line's label and its fold chip (the page gives `style.transform`). */
export function EdgeLabelRow(props: Omit<React.ComponentProps<"div">, "className">) {
  return <div className="nodrag nopan pointer-events-none absolute flex items-center gap-1" {...props} />
}

/** The text of a workflow line, on a small card: inside an `EdgeLabelRow`, or `floating` on its own over the graph (the page gives `style.transform`). */
export function EdgeLabelPill({ floating, ...props }: Omit<React.ComponentProps<"div">, "className"> & { floating?: boolean }) {
  return floating ? <div className={clsx("pointer-events-none absolute", PILL)} {...props} /> : <span className={PILL} {...(props as React.ComponentProps<"span">)} />
}

/** Something pressable laid on a workflow line with its middle at `at` (a line's 출구 표지, its 동작 add button). */
export function EdgeAnchor({ at, children }: { at: { x: number; y: number }; children: React.ReactNode }) {
  return (
    <div className="nodrag nopan pointer-events-auto absolute" style={{ transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` }}>
      {children}
    </div>
  )
}
