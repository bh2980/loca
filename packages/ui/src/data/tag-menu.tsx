import { Tags } from "lucide-react"
import { Button } from "../primitives/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu"
import { PickedLabel } from "./picked-bar"
import { TagChip, type StatusLike } from "../tokens/status"

export type TagState = "all" | "some" | "none"

export interface TagMenuProps {
  tags: StatusLike[]
  state: (tagId: string) => TagState
  onToggle: (tagId: string, add: boolean) => void
  heading: string
}

export function TagMenu({ tags, state, onToggle, heading }: TagMenuProps) {
  if (!tags.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" aria-label="태그 붙이기·떼기" className="h-6 gap-1 px-2 text-xs">
          <Tags className="size-3 opacity-70" />
          <PickedLabel>태그</PickedLabel>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {heading}
        </DropdownMenuLabel>
        {tags.map((tag) => {
          const current = state(tag.id)
          return (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={current === "all"}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onToggle(tag.id, current !== "all")}
            >
              <TagChip tag={tag} />
              {current === "some" && (
                <span className="ml-auto text-[10px] text-muted-foreground">일부</span>
              )}
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
