import type { ReactNode } from "react"
import { Button, type ButtonProps } from "../../controls/button"
import { cn } from "../../lib/utils"

export function MenuRowAction({ danger = false, onClick, ...props }: Omit<ButtonProps, "className" | "onPointerDown" | "onPointerUp"> & { danger?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted opacity-0 group-hover/row:opacity-100 group-focus/row:opacity-100", danger && "hover:text-danger")}
      {...props}
      // The row picks itself on pointerup (Radix menu items): the press is the button's, down, up and click, or the row would
      // be picked and the menu close (renaming a conversation closed the menu before its box opened).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
    />
  )
}

/** A figure at the end of a menu row (a count) that gives its place to the row's action while the row is hovered or focused, so the action takes no room of its own. */
export function MenuRowMeta({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <span className="grid shrink-0 items-center justify-items-end *:col-start-1 *:row-start-1">
      <span className="text-xs text-muted tabular-nums group-hover/row:invisible group-focus/row:invisible">{children}</span>
      {action}
    </span>
  )
}
