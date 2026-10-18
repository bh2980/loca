import type { ReactNode } from "react"
import { ToggleGroup, ToggleGroupItem } from "../primitives/toggle-group"
export interface ViewSwitchItem { value: string; label: string; icon?: ReactNode }
export function ViewSwitch({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: ViewSwitchItem[] }) {
  return <ToggleGroup type="single" variant="outline" value={value} onValueChange={(next) => next && onChange(next)} aria-label={label} className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-chrome p-0.5">
    {items.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium tracking-tight data-[state=on]:bg-card data-[state=on]:shadow-2xs [&_svg]:size-3.5 [&_svg]:stroke-[1.65]">{item.icon}{item.label}</ToggleGroupItem>)}
  </ToggleGroup>
}
