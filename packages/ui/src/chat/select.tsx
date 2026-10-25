import type { LucideIcon } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../primitives/select"
import { cn } from "../lib/utils"

/** A small select for filtering a list by kind (36 wide, caption text). */
export function CompactSelect({ value, onValueChange, options, label }: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" className="w-36 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

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
      <SelectTrigger size="sm" className={cn(compact && "border-0 bg-transparent px-1.5 shadow-none", warn && "text-warning", width === "medium" && "w-48")} aria-label={label}>
        <Icon />
        {/* Closed, the select shows the mode's name only; the list explains each. */}
        <SelectValue>{selected?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-80">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex flex-col gap-0.5 whitespace-normal">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
