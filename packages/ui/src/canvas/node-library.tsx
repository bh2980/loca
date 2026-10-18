import { useMemo, useState, type ReactNode } from "react"
import { Search } from "lucide-react"
import { Button } from "../primitives/button"
import { Input } from "../primitives/input"
import { cn } from "../lib/utils"
import type { NodeCardKind } from "./node-card"

export interface NodeLibraryItem {
  id: string
  label: string
  kind: NodeCardKind
  icon?: ReactNode
  description?: string
}

export interface NodeLibraryGroup { id: string; label: string; items: NodeLibraryItem[] }
export interface NodeLibraryProps {
  groups: NodeLibraryGroup[]
  onSelect: (item: NodeLibraryItem) => void
  onDragStart?: (item: NodeLibraryItem, event: React.DragEvent<HTMLButtonElement>) => void
  placeholder?: string
  className?: string
}

const kindDots: Record<NodeCardKind, string> = {
  entry: "bg-muted-foreground", ai: "bg-ai", function: "bg-primary", condition: "bg-review", status: "bg-success", end: "bg-muted-foreground",
}

/** Searchable node palette. Items can be clicked or dragged onto a canvas. */
export function NodeLibrary({ groups, onSelect, onDragStart, placeholder = "노드 찾기", className }: NodeLibraryProps) {
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return groups.map((group) => ({ ...group, items: group.items.filter((item) => !needle || `${item.label} ${item.description ?? ""} ${group.label}`.toLocaleLowerCase().includes(needle)) })).filter((group) => group.items.length)
  }, [groups, query])
  return <section className={cn("flex min-h-0 flex-col bg-navigation", className)} aria-label="노드 라이브러리">
    <label className="relative m-2 block shrink-0">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="노드 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="h-7 pl-7 text-xs" />
    </label>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {filtered.map((group) => <div key={group.id} className="mb-3">
        <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
        {group.items.map((item) => <Button key={item.id} variant="ghost" size="row" draggable onClick={() => onSelect(item)} onDragStart={(event) => { event.dataTransfer.setData("application/x-loca-workflow-node", item.id); event.dataTransfer.effectAllowed = "copy"; onDragStart?.(item, event) }} className="h-7 gap-2 rounded-sm px-2 text-xs">
          <span className={cn("size-2 shrink-0 rounded-[2px]", kindDots[item.kind])} aria-hidden="true" />
          {item.icon != null && <span className="flex shrink-0 [&_svg]:size-3.5">{item.icon}</span>}
          <span className="truncate">{item.label}</span>
        </Button>)}
      </div>)}
      {filtered.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">검색 결과가 없습니다.</p>}
    </div>
    <p className="shrink-0 px-4 py-4 text-xs text-subtle-foreground">끌어서 캔버스에 놓기</p>
  </section>
}
