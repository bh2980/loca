import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button, type ButtonProps } from "../../controls/button"
import { cn } from "../../lib/utils"

/** A labeled editor action with one consistent, readable icon. */
export function EditorAction({ icon: Icon, children, variant = "default", ...props }: Omit<ButtonProps, "children" | "className"> & { icon: LucideIcon; children: ReactNode }) {
  return <Button size="sm" variant={variant} gap="tight" {...props}><Icon aria-hidden="true" className={cn("size-3.5 shrink-0", variant === "default" ? "text-on-accent" : "text-default")} />{children}</Button>
}
