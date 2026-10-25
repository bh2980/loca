import type { LucideIcon } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../controls/select"
import { cn } from "../../lib/utils"

/**
 * A choice among a few named modes, each explained under its name in the open list. `compact` drops the trigger's border and background (it
 * sits in a footer); `warn` colors a mode that skips safeguards.
 */
export function ModeSelect({ value, options, icon: Icon, onValueChange, label, compact = false, warn = false, width, disabled = false, open, onOpenChange }: {
  value: string
  options: { value: string; label: string; description: string }[]
  /** The selected mode's icon, shown in the trigger. */
  icon: LucideIcon
  onValueChange: (value: string) => void
  /** The trigger's accessible name. */
  label: string
  compact?: boolean
  warn?: boolean
  /** `medium` fixes the trigger at 12rem. */
  width?: "medium"
  disabled?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <Select open={open} onOpenChange={onOpenChange} value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger bare={compact} width={width === "medium" ? "menu-sm" : undefined} className={cn(warn && "text-warning")} aria-label={label}>
        <Icon />
        {/* Closed, the select shows the mode's name only; the list explains each. */}
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-80">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex flex-col gap-0.5 whitespace-normal">
              <span>{option.label}</span>
              <span className="text-xs text-muted">{option.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
