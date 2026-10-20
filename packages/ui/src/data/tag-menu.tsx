import { useState } from "react"
import { Tags, X } from "lucide-react"
import { Button } from "../primitives/button"
import { Input } from "../primitives/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu"
import { SelectionLabel } from "./picked-bar"
import { TagChip, chipStyle, type StatusLike } from "../tokens/status"
import { cn } from "../lib/utils"

export type TagState = "all" | "some" | "none"

export interface TagMenuProps {
  tags: (StatusLike & { role?: string | null })[]
  state: (tagId: string) => TagState
  onToggle: (tagId: string, add: boolean) => void
  heading: string
  onCreate?: (name: string) => Promise<void> | void
  triggerLabel?: string
  className?: string
}

/** The tag list and the new-tag field, as the content of a menu or a submenu. */
function TagMenuItems({ tags, state, onToggle, heading, onCreate }: Pick<TagMenuProps, "tags" | "state" | "onToggle" | "heading" | "onCreate">) {
  const [newTagName, setNewTagName] = useState("")
  const [creating, setCreating] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newTagName.trim()
    if (!trimmed || creating || !onCreate) return
    setCreating(true)
    try {
      await onCreate(trimmed)
      setNewTagName("")
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
        <DropdownMenuLabel className="text-2xs text-muted-foreground uppercase tracking-wider">
          {heading}
        </DropdownMenuLabel>
        {tags.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">태그가 없습니다.</div>
        ) : (
          tags.map((tag) => {
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
                  <span className="ml-auto text-2xs text-muted-foreground">일부</span>
                )}
              </DropdownMenuCheckboxItem>
            )
          })
        )}
        {onCreate && (
          <>
            <DropdownMenuSeparator />
            <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
              <form onSubmit={handleCreate} className="flex items-center gap-1">
                <Input
                  placeholder="새 태그 이름…"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="h-7 text-xs"
                  disabled={creating}
                  autoFocus={tags.length === 0}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="xs"
                  disabled={!newTagName.trim() || creating}
                  className="h-7 shrink-0 px-2 text-xs"
                >
                  + 만들기
                </Button>
              </form>
            </div>
          </>
        )}
    </>
  )
}

export function TagMenu({ tags, state, onToggle, heading, onCreate, triggerLabel, className }: TagMenuProps) {
  if (!tags.length && !onCreate) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" aria-label="태그 붙이기·떼기" className={cn("h-6 gap-1 px-2 text-xs", className)}>
          <Tags className="size-3 opacity-70" />
          <SelectionLabel>{triggerLabel ?? "태그"}</SelectionLabel>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-1">
        <TagMenuItems tags={tags} state={state} onToggle={onToggle} heading={heading} onCreate={onCreate} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The same picker as a submenu of another dropdown menu (a line's ⋯ menu). */
/** `icon` false: in a menu whose other items have none. */
export function TagSubMenu({ tags, state, onToggle, heading, onCreate, label = "태그 붙이기·떼기", icon = true }: Pick<TagMenuProps, "tags" | "state" | "onToggle" | "heading" | "onCreate"> & { label?: string; icon?: boolean }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {icon && <Tags />}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56 p-1">
        <TagMenuItems tags={tags} state={state} onToggle={onToggle} heading={heading} onCreate={onCreate} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export interface TagListEditorProps {
  tags: (StatusLike & { role?: string | null })[]
  allTags: (StatusLike & { role?: string | null })[]
  onToggle: (tagId: string, add: boolean) => void
  onCreate?: (name: string) => Promise<void> | void
  heading?: string
  triggerLabel?: string
  readOnly?: boolean
  className?: string
}

export function TagListEditor({
  tags,
  allTags,
  onToggle,
  onCreate,
  heading = "태그",
  triggerLabel = "+ 태그",
  readOnly,
  className,
}: TagListEditorProps) {
  const attachedIds = new Set(tags.map((t) => t.id))
  const assignableTags = allTags.filter((t) => !t.role)

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} onClick={(e) => e.stopPropagation()}>
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap"
          style={chipStyle(tag.color)}
        >
          #{tag.name}
          {!readOnly && !tag.role && (
            <Button
              type="button"
              variant="ghost"
              size="inline"
              className="size-3.5 p-0 hover:bg-transparent text-current opacity-70 hover:opacity-100"
              aria-label={`${tag.name} 태그 제거`}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(tag.id, false)
              }}
            >
              <X className="size-3" />
            </Button>
          )}
        </span>
      ))}
      {!readOnly && (
        <TagMenu
          tags={assignableTags}
          state={(tagId) => (attachedIds.has(tagId) ? "all" : "none")}
          onToggle={onToggle}
          heading={heading}
          onCreate={onCreate}
          triggerLabel={triggerLabel}
        />
      )}
    </div>
  )
}

