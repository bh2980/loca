import type { CSSProperties } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns3, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type ColumnItem = { id: string; label: string; shown: boolean; hideable: boolean };

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function ColumnRow({ item, onToggle }: { item: ColumnItem; onToggle: (shown: boolean) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 1 : undefined };
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-1 rounded-md bg-popover py-0.5 text-sm">
      <Button ref={setActivatorNodeRef} variant="ghost" size="icon-xs" className="cursor-grab touch-none text-muted-foreground" aria-label={`${item.label} 순서 바꾸기 (스페이스를 누르고 ↑↓)`} {...attributes} {...listeners}>
        <GripVertical />
      </Button>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <Checkbox checked={item.shown} disabled={!item.hideable} onCheckedChange={(checked) => onToggle(Boolean(checked))} aria-label={`${item.label} 보이기`} />
        <span className="truncate">{item.label}</span>
      </label>
    </li>
  );
}

/** Which columns show and in what order: a popover list with drag handles (mouse or keyboard) and checkboxes. */
export function ColumnMenu({ items, onReorder, onToggle, onReset }: {
  items: ColumnItem[];
  onReorder: (ids: string[]) => void;
  onToggle: (id: string, shown: boolean) => void;
  onReset: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = items.map((item) => item.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="열 고르기" title="열 고르기">
          <Columns3 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <ColumnRow key={item.id} item={item} onToggle={(shown) => onToggle(item.id, shown)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button variant="ghost" className="mt-1 w-full" title="열 순서, 보이기, 너비를 모두 처음으로" onClick={onReset}>
          기본으로
        </Button>
      </PopoverContent>
    </Popover>
  );
}
