import type { ReactNode } from "react"
import { Check, X } from "lucide-react"
import { Button, type ButtonProps } from "../controls/button"
import { Input } from "../controls/input"
import { cn } from "../lib/utils"

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

/**
 * A menu row while it is renamed in place: the name box with save and cancel. Keys typed in the box stay in it
 * (the menu's type-ahead does not take them); Enter saves and Esc drops the edit without closing the menu.
 */
export function MenuRenameRow({ value, label, maxLength, onChange, onCommit, onCancel }: {
  value: string
  /** What the box names, for screen readers: "대화 이름". */
  label: string
  maxLength?: number
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <Input
        autoFocus
        value={value}
        maxLength={maxLength}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          // An Enter that ends an IME composition is not the save.
          if (event.nativeEvent.isComposing) return
          if (event.key === "Enter" && value.trim()) onCommit()
          if (event.key === "Escape") onCancel()
        }}
      />
      <Button variant="ghost" size="icon-xs" aria-label="이름 저장" onClick={onCommit} disabled={!value.trim()}>
        <Check />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="이름 바꾸기 취소" onClick={onCancel}>
        <X />
      </Button>
    </div>
  )
}
