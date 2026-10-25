import { Button, type ButtonProps } from "../../controls/button"
import { cn } from "../../lib/utils"

export function ConversationRowAction({ danger = false, ...props }: Omit<ButtonProps, "className"> & { danger?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted opacity-0 group-hover/row:opacity-100 group-focus/row:opacity-100", danger && "hover:text-danger")}
      {...props}
    />
  )
}
