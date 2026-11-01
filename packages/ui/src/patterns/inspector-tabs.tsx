import type { ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "../controls/tabs"

export interface InspectorTabsProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  /** `count` follows the label in a quieter weight (이력 6); `null` while it is still loading (이력 …). */
  items: { value: T; label: ReactNode; count?: number | null }[]
}

/** Line-style inspector navigation. A single tab adds no useful choice, so it stays hidden. */
export function InspectorTabs<T extends string = string>({ value, onChange, items }: InspectorTabsProps<T>) {
  if (items.length <= 1) return null
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className="shrink-0">
      <TabsList variant="line" className="h-10 w-full justify-start gap-1 border-b border-default bg-panel px-4">
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="h-full flex-none px-2 text-sm">
            {item.label}
            {item.count !== undefined && <span className="font-normal text-subtle tabular-nums">{item.count ?? "…"}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
