import type { ReactNode } from "react"
import { SegmentedControl } from "./segmented-control"
export interface ViewSwitchItem { value: string; label: string; icon?: ReactNode }
export function ViewSwitch({ label, value, onChange, items }: { label: string; value: string; onChange: (value: string) => void; items: ViewSwitchItem[] }) {
  return <SegmentedControl ariaLabel={label} value={value} onChange={onChange} className="shrink-0" items={items.map((item) => ({ value: item.value, label: <>{item.icon}{item.label}</> }))} />
}
