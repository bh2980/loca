import type * as React from "react"
import { clsx } from "clsx"

/**
 * A row of the run dialog's scope list: a checkbox, a title and a count on one line, lit under the pointer. `all` is the 전체 row
 * (medium weight), `section` the row of a kind that sits beside its fold arrow (no left padding).
 */
export function ScopeRow({ kind, ...props }: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "className"> & { kind?: "all" | "section" }) {
  return <label className={clsx("flex min-w-0 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-sunken", kind === "all" && "font-medium", kind === "section" && "min-w-0 flex-1 pl-0")} {...props} />
}

/** The mark before a readiness line: green when it is done, amber when it still needs something. */
export function ReadinessDot({ ok }: { ok: boolean }) {
  return <span className={clsx("size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-warning")} />
}
