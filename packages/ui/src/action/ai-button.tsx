import type { ComponentProps } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export type AiButtonProps = ComponentProps<typeof Button>

/**
 * AiButton: Distinctive AI trigger button with Sparkles icon and subtle elevation.
 */
export function AiButton({
  children,
  className,
  variant = "outline",
  size = "sm",
  ...props
}: AiButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "gap-1.5 border-primary/20 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/40 transition-colors",
        className
      )}
      {...props}
    >
      <Sparkles className="size-3 text-primary shrink-0" />
      {children}
    </Button>
  )
}
