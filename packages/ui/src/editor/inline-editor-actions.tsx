import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button, type ButtonProps } from "../primitives/button"
import { cn } from "../lib/utils"

/** Action slots for a focused editor row. Callers supply Buttons to keep labels and behavior local. */
export function InlineEditorActions({ primary, ai, overflow, className, fixed }: { primary: ReactNode; ai?: ReactNode; overflow?: ReactNode; className?: string; /** Does not shrink when the row is narrow. */ fixed?: boolean }) {
  return <div className={cn("flex min-w-0 items-center gap-1.5", fixed && "shrink-0", className)}>{primary}{ai}{overflow}</div>
}

/** A labeled editor action with one consistent, readable icon. */
export function EditorAction({ icon: Icon, children, className, variant = "default", ...props }: Omit<ButtonProps, "children"> & { icon: LucideIcon; children: ReactNode }) {
  return <Button size="sm" variant={variant} className={cn("gap-1.5", className)} {...props}><Icon aria-hidden="true" className={cn("size-3.5 shrink-0", variant === "default" ? "text-primary-foreground" : "text-foreground")} />{children}</Button>
}
