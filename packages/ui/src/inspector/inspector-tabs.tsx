import type { ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "../primitives/tabs"
import { cn } from "../lib/utils"

export interface InspectorTabsProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: ReactNode }[]
  className?: string
}

/** Line-style inspector navigation. A single tab adds no useful choice, so it stays hidden. */
export function InspectorTabs<T extends string = string>({ value, onChange, items, className }: InspectorTabsProps<T>) {
  if (items.length <= 1) return null
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className={cn("shrink-0", className)}>
      <TabsList variant="line" className="h-9 w-full justify-start gap-1 border-b border-border-subtle bg-panel px-4">
        {items.map((item) => <TabsTrigger key={item.value} value={item.value} className="h-full flex-none px-2.5">{item.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}
