import type { ReactNode } from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "../lib/utils"
import { STYLE } from "../primitives/style"
import { Switch } from "../controls/switch"
import { HelpTip } from "../controls/tooltip"

export type InspectorResultTone = "ok" | "error" | "pending" | "info"

/** What an action in a pane gave back, right under it: a status line, then any detail (mono when it is data). */
export function InspectorResult({ tone, children, detail }: { tone: InspectorResultTone; children: ReactNode; detail?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "error" ? AlertCircle : tone === "pending" ? Loader2 : null
  return (
    <div className="min-w-0 space-y-1 text-xs" role={tone === "error" ? "alert" : "status"}>
      <p className={cn("flex min-w-0 items-start gap-1.5", tone === "ok" ? "text-success" : tone === "error" ? "text-danger" : "text-muted")}>
        {Icon && <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "pending" && "animate-spin")} />}
        <span className="min-w-0 break-words">{children}</span>
      </p>
      {detail && <div className="min-w-0 pl-5 text-muted">{detail}</div>}
    </div>
  )
}

/**
 * An action a pane offers besides saving (connection check, login status, model test): its name on
 * the left, its one button on the right, and what it gave back underneath, so each result sits under
 * the action that produced it. Rows are divided by a hairline, not boxed.
 */
export function InspectorActionRow({ label, description, action, result, children }: { label: ReactNode; description?: ReactNode; action: ReactNode; result?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2 py-2.5 first:pt-0 last:pb-0 [&+&]:border-t [&+&]:border-subtle">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-default">{label}</p>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      </div>
      {children}
      {result}
    </div>
  )
}

/** A yes/no setting: its label (and a one-line description) left, the switch right; `description` and `help` as in `Field`. */
export function InspectorToggle({ label, description, help, checked, disabled, onChange }: { label: ReactNode; description?: ReactNode; help?: ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm text-default">{label}{help && <HelpTip>{help}</HelpTip>}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

/** Rows of a list inside a section (lines, calls, rules): divided by hairlines, never boxed. */
export function InspectorList({ children, body, scroll }: { children: ReactNode; /** Rows in the body type (text-sm). */ body?: boolean; /** The height the list stops growing at; it scrolls past it. */ scroll?: keyof typeof STYLE.maxHeight }) {
  return <ul className={cn("min-w-0 divide-y divide-subtle", body && "text-sm", scroll && ["overflow-auto", STYLE.maxHeight[scroll]])}>{children}</ul>
}
