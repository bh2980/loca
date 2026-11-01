import type { ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "../controls/tabs"

export interface InspectorTabItem<T extends string = string> {
  value: T
  label: ReactNode
  /** Follows the label in a quieter weight (이력 6, also 근거 대사 0); `null` while it is still loading (이력 …). */
  count?: number | null
  /** A dot after the label: something in the tab waits for you (an unsaved edit, a candidate to decide). Tabs never switch by themselves; the dot says where to look. */
  attention?: boolean
}

export interface InspectorTabsProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  items: InspectorTabItem<T>[]
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
            {item.attention && <span aria-label="확인할 것 있음" className="size-1.5 shrink-0 rounded-full bg-accent" />}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
