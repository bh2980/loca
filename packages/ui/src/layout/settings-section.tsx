import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { HelpTip } from "../primitives/help-tip"

/**
 * One titled block of a settings page (#48). Blocks stack in a column, separated by a rule, so every
 * settings page reads the same way. The save rule is one for all of them:
 * - controls that take effect at once (switches, selects) save on change, with a toast;
 * - typed fields (names, rules) save with the block's own 저장 button in `actions`, enabled only
 *   when something changed, with 되돌리기 beside it.
 * `tone="danger"` is the danger zone: a destructive-bordered box at the end of the page.
 */
export function SettingsSection({
  title,
  description,
  help,
  actions,
  tone = "default",
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  help?: ReactNode
  /** The block's save / revert buttons, under its fields. */
  actions?: ReactNode
  tone?: "default" | "danger"
  children?: ReactNode
  className?: string
}) {
  const danger = tone === "danger"
  return (
    <section
      className={cn(
        danger
          ? "space-y-3 rounded-lg border border-destructive/30 p-4"
          : "space-y-4 pt-8",
        className
      )}
    >
      <div className="space-y-1">
        <h2 className={cn("flex items-center gap-1 text-base font-semibold", danger && "text-destructive")}>{title}{help && <HelpTip>{help}</HelpTip>}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </section>
  )
}
