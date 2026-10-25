import { useEffect, useRef } from "react"
import type * as React from "react"
import { ChevronRight } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "../primitives/command"
import { Spinner } from "../primitives/spinner"
import { Textarea } from "../primitives/textarea"
import { cn } from "../lib/utils"

/**
 * One line of the list over the chat box. `screen` and `item` are things to attach, `kind` narrows to a
 * kind, `header` is a kind's title in a search (Tab narrows to it), `more` loads the next page, `command`
 * is a / entry.
 */
export interface MenuRow {
  id: string
  type: "screen" | "kind" | "header" | "item" | "more" | "command"
  label: string
  detail?: string
  /** The kind, shown before the label where rows of several kinds share a group (지금 화면). */
  tag?: string
  /** Waiting for its page (더 보기). */
  busy?: boolean
}

export interface MenuGroup {
  key: string
  heading?: string
  rows: MenuRow[]
}

/**
 * The list over the chat box for @ (things to attach) and / (commands). Focus stays in the box: the
 * box's key handler moves `activeId` and picks; the pointer hovers and clicks here. The active row is
 * kept in view as it moves.
 */
export function ComposerMenu({ id, groups, activeId, onActive, onPick, loading, empty, title, hint }: {
  id: string
  groups: MenuGroup[]
  activeId: string | undefined
  onActive: (id: string) => void
  onPick: (row: MenuRow) => void
  loading?: boolean
  empty: string
  title: string
  hint: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const count = groups.reduce((sum, group) => sum + group.rows.length, 0)
  useEffect(() => {
    if (!activeId) return
    // 'nearest': a row already in view stays put; one past an edge scrolls just enough to show.
    list.current?.querySelector(`[data-row-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [activeId, count])
  return (
    <div id={id} role="listbox" aria-label={title} className="absolute inset-x-0 bottom-full z-20 mb-1 overflow-hidden rounded-md border bg-popover shadow-md" onMouseDown={(event) => event.preventDefault()}>
      <Command shouldFilter={false} value={activeId} onValueChange={onActive} className="h-auto">
        <CommandList ref={list} className="max-h-64">
          {loading && !count ? (
            <div className="flex items-center justify-center py-4"><Spinner /></div>
          ) : (
            <CommandEmpty>{empty}</CommandEmpty>
          )}
          {groups.map((group) => (
            <CommandGroup key={group.key} heading={group.heading}>
              {group.rows.map((row) => (
                <CommandItem key={row.id} value={row.id} data-row-id={row.id} onSelect={() => onPick(row)} className="text-sm">
                  {row.type === "header" ? (
                    <>
                      <ChevronRight className="text-muted-foreground" />
                      <span className="shrink-0 font-medium">{row.label}</span>
                      {row.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{row.detail}</span>}
                    </>
                  ) : row.type === "more" ? (
                    <span className="flex flex-1 items-center justify-center gap-1.5 text-xs text-muted-foreground">
                      {row.busy && <Spinner className="size-3" />}
                      {row.label}
                    </span>
                  ) : (
                    <>
                      {row.tag && <span className="shrink-0 text-xs text-muted-foreground">{row.tag}</span>}
                      <span className="min-w-0 shrink truncate">{row.label}</span>
                      {row.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{row.detail}</span>}
                    </>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
      <p className="border-t px-2 py-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/** The chat box's text field: no border or background of its own, it sits in the panel's footer. */
export function ComposerInput({ className, ...props }: React.ComponentProps<typeof Textarea>) {
  return <Textarea className={cn("max-h-48 min-h-16 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0", className)} {...props} />
}
