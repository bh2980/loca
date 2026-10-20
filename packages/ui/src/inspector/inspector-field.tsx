import { useId, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "../lib/utils"
import { ControlIdContext } from "../primitives/control-id"
import { Switch } from "../primitives/switch"
import { HelpTip } from "../primitives/tooltip"

/**
 * One input in a pane, always the same shape in a ~360px column: a small label over the control,
 * then a one-line description or error. `action` sits right of the label (a small button or switch).
 * Two kinds of explanation, never mixed: `description` (shown) says how to fill it in (a format, what
 * empty means); `help` (a ? beside the label) says what the setting is and what changing it does.
 * Read-only values use PropertyRow instead.
 */
export function InspectorField({ label, description, help, error, action, children, className }: { label: ReactNode; description?: ReactNode; help?: ReactNode; error?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex min-h-5 min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <label htmlFor={id} className="min-w-0 truncate text-xs text-muted-foreground">
            {label}
          </label>
          {help && <HelpTip>{help}</HelpTip>}
        </span>
        {action}
      </div>
      <ControlIdContext.Provider value={id}>{children}</ControlIdContext.Provider>
      {error ? <p className="text-xs text-destructive">{error}</p> : description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

/** Fields of a section, one under another. */
export function InspectorFields({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-3", className)}>{children}</div>
}

export type InspectorResultTone = "ok" | "error" | "pending" | "info"

/** What an action in a pane gave back, right under it: a status line, then any detail (mono when it is data). */
export function InspectorResult({ tone, children, detail, className }: { tone: InspectorResultTone; children: ReactNode; detail?: ReactNode; className?: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "error" ? AlertCircle : tone === "pending" ? Loader2 : null
  return (
    <div className={cn("min-w-0 space-y-1 text-xs", className)} role={tone === "error" ? "alert" : "status"}>
      <p className={cn("flex min-w-0 items-start gap-1.5", tone === "ok" ? "text-success" : tone === "error" ? "text-destructive" : "text-muted-foreground")}>
        {Icon && <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone === "pending" && "animate-spin")} />}
        <span className="min-w-0 break-words">{children}</span>
      </p>
      {detail && <div className="min-w-0 pl-5 text-muted-foreground">{detail}</div>}
    </div>
  )
}

/**
 * An action a pane offers besides saving (connection check, login status, model test): its name on
 * the left, its one button on the right, and what it gave back underneath, so each result sits under
 * the action that produced it. Rows are divided by a hairline, not boxed.
 */
export function InspectorActionRow({ label, description, action, result, children, className }: { label: ReactNode; description?: ReactNode; action: ReactNode; result?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-2 py-2.5 first:pt-0 last:pb-0 [&+&]:border-t [&+&]:border-border-subtle", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{label}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">{action}</div>
      </div>
      {children}
      {result}
    </div>
  )
}

/** A yes/no setting: its label (and a one-line description) left, the switch right. */
/** A switch row; `description` and `help` as in InspectorField. */
export function InspectorToggle({ label, description, help, checked, disabled, onChange, className }: { label: ReactNode; description?: ReactNode; help?: ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; className?: string }) {
  return (
    <label className={cn("flex min-w-0 items-center justify-between gap-3", className)}>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm text-foreground">{label}{help && <HelpTip>{help}</HelpTip>}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

/** Rows of a list inside a section (lines, calls, rules): divided by hairlines, never boxed. */
export function InspectorList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("min-w-0 divide-y divide-border-subtle", className)}>{children}</ul>
}
