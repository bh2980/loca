import * as React from "react"
import { cn } from "../lib/utils"
import { STYLE } from "../primitives/style"
import { useControlId } from "./control-id"

function Textarea({
  className,
  id,
  mono,
  variant,
  autoSize,
  resize,
  ...props
}: React.ComponentProps<"textarea"> & {
  /** A monospace face (markup, code, a prompt). */
  mono?: boolean
  /** Text size: caption (default) or body. */
  variant?: "caption" | "body"
  /** Grows with its text. */
  autoSize?: boolean
  /** `none`: cannot be resized by hand. */
  resize?: keyof typeof STYLE.resize
}) {
  return (
    <textarea
      id={useControlId(id)}
      data-slot="textarea"
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-default bg-page px-2 py-2 text-xs shadow-xs transition-colors outline-none",
        "placeholder:text-muted hover:border-default",
        "focus-visible:border-focus focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
        mono && "font-mono",
        variant === "body" && "text-sm",
        autoSize && STYLE.fieldSizing.content,
        resize && STYLE.resize[resize],
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
