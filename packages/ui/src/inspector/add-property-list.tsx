import { Plus } from "lucide-react"
import { Button } from "../primitives/button"
import { cn } from "../lib/utils"

export interface AddPropertyListProps {
  items: { id: string; label: string; onAdd: () => void }[]
  className?: string
}

export function AddPropertyList({ items, className }: AddPropertyListProps) {
  if (items.length === 0) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((item) => (
        <Button key={item.id} type="button" variant="ghost" onClick={item.onAdd}>
          <Plus aria-hidden="true" />{item.label} 추가
        </Button>
      ))}
    </div>
  )
}
