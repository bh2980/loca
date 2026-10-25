import type { CSSProperties } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Columns3, GripVertical } from "lucide-react"
import { Button } from "../controls/button"
import { Checkbox } from "../controls/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "../controls/popover"

export type ColumnItem = { id: string; label: string; shown: boolean; hideable: boolean }

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

function ColumnRow({
  item,
  onToggle,
}: {
  item: ColumnItem
  onToggle: (shown: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 rounded-xs bg-overlay py-0.5 text-xs"
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-xs"
        className="cursor-grab touch-none text-muted hover:text-default"
        aria-label={`${item.label} 순서 바꾸기 (스페이스를 누르고 ↑↓)`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </Button>
      <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer select-none">
        <Checkbox
          checked={item.shown}
          disabled={!item.hideable}
          onCheckedChange={(checked) => onToggle(Boolean(checked))}
          aria-label={`${item.label} 보이기`}
        />
        <span className="truncate text-xs">{item.label}</span>
      </label>
    </li>
  )
}

export function ColumnMenu({
  items,
  onReorder,
  onToggle,
  onReset,
}: {
  items: ColumnItem[]
  onReorder: (ids: string[]) => void
  onToggle: (id: string, shown: boolean) => void
  onReset: () => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const ids = items.map((item) => item.id)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted hover:text-default"
          aria-label="열 고르기"
          title="열 고르기"
        >
          <Columns3 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" width="menu" padding="condensed">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="max-h-72 overflow-y-auto space-y-0.5">
              {items.map((item) => (
                <ColumnRow
                  key={item.id}
                  item={item}
                  onToggle={(shown) => onToggle(item.id, shown)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button
          variant="ghost"
          size="xs"
          className="mt-1.5 w-full text-xs text-muted hover:text-default"
          onClick={onReset}
        >
          기본으로
        </Button>
      </PopoverContent>
    </Popover>
  )
}
