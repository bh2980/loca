import { DropdownMenuItem } from "../../controls/dropdown-menu"
import { cn } from "../../lib/utils"

/** One way out of a fork in a menu of the reading route: its name (and the line it starts with), the chosen one marked. */
export function ForkOptionItem({ label, preview, selected, onSelect }: { label: string; preview?: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn("flex flex-col items-start gap-0.5 py-1.5 cursor-pointer", selected && "font-medium bg-sunken/40")}>
      <div className="flex w-full items-center justify-between text-sm">
        <span className="truncate font-medium">{label}</span>
        {selected && <span className="text-xs text-accent font-medium">선택됨</span>}
      </div>
      {preview && preview !== label && <span className="line-clamp-2 text-xs text-muted font-normal">{preview}</span>}
    </DropdownMenuItem>
  )
}
