import { createContext, useContext, type ReactNode } from "react"
import { cn } from "../lib/utils"

type KeyValueAlign = "center" | "start"

const AlignContext = createContext<KeyValueAlign>("center")

/**
 * Rows of a label and its value (or control), the labels in one column (5.5rem), so a pane's facts and a popover's settings line up.
 * `center` centres a row's label and value on each other (the facts of an item); `start` aligns them at the top (a value or control that
 * may wrap, filters, a summary). `framed` draws a hairline box around the rows.
 */
export function KeyValue({ align = "center", framed, children }: { align?: KeyValueAlign; framed?: boolean; children?: ReactNode }) {
  return (
    <AlignContext.Provider value={align}>
      <div className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 text-sm", align === "center" ? "items-center gap-y-2.5" : "items-start gap-y-2", framed && "rounded-md border p-3")}>
        {children}
      </div>
    </AlignContext.Provider>
  )
}

/** A row of a `KeyValue`: the label in the muted caption type, the value beside it; `description` under both. */
export function KeyValueRow({ label, children, description }: { label: ReactNode; children?: ReactNode; description?: ReactNode }) {
  const align = useContext(AlignContext)
  if (align === "start")
    return (
      <div className="col-span-2 grid grid-cols-subgrid items-start">
        <div className="min-w-0 pt-0.5 text-xs text-muted">{label}</div>
        <div className="min-w-0">{children}</div>
        {description != null && <p className="col-span-2 text-xs font-normal text-muted">{description}</p>}
      </div>
    )
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-center gap-x-3 gap-y-1">
      <div className="min-w-0 self-start pt-1">
        <div className="min-w-0 whitespace-normal break-words text-xs text-muted">{label}</div>
      </div>
      <div className="min-w-0 text-sm">{children}</div>
      {description != null && <p className="col-span-2 text-xs font-normal text-muted">{description}</p>}
    </div>
  )
}
