import { ArrowRight, Tag } from "lucide-react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../controls/hover-card"
import { cn } from "../../lib/utils"
import { StatusIcon, TagChip } from "../../patterns/status"

/** One thing an exit does to the lines leaving it: a tag it puts on or takes off, or the status it sets. */
export interface ExitTagItem {
  kind: "tag" | "status"
  /** A tag: put on or taken off. */
  action?: "add" | "remove"
  /** A tag's or status's name; for tags a result decides (fromResult), the step whose result it is ("AI 검수"). */
  name: string
  /** The stored colour of the tag or status. */
  color?: string
  /** Tags the step's result decides: each value it gives stands for a tag (`options`, the ones set for its values). */
  fromResult?: boolean
  /** The tags a result's values stand for, as set on the action; a value not set takes the tag of its own name. */
  options?: { name: string; color?: string }[]
  /** A status's kind and review flag, for its icon's shape (StatusIcon). */
  statusKind?: "initial" | "normal" | "final"
  inReview?: boolean
}

/**
 * "+1 −7": how many tags it puts on and takes off. Tags a result decides count at most as many as are set for its values
 * ("+최대 6"); with none set, how many is the result's ("+?").
 */
function tagCounts(tags: readonly ExitTagItem[]) {
  const count = (action: "add" | "remove", sign: string) => {
    const own = tags.filter((item) => (item.action ?? "add") === action)
    if (!own.length) return undefined
    const result = own.filter((item) => item.fromResult)
    if (result.some((item) => !item.options?.length)) return `${sign}?`
    const total = own.length - result.length + result.reduce((sum, item) => sum + item.options!.length, 0)
    return `${sign}${result.length ? "최대 " : ""}${total}`
  }
  return [count("add", "+"), count("remove", "−")].filter(Boolean).join(" ")
}

/** The exit's actions in words, one per line: the button's accessible name. */
export const exitTagWords = (items: readonly ExitTagItem[]) =>
  items.map((item) => {
    const verb = item.action === "remove" ? "제거" : "추가"
    if (item.kind === "status") return `상태 → ${item.name}`
    return item.fromResult ? `${item.name} 결과에 따라 태그 ${verb}` : `태그 ${verb} #${item.name}`
  })

/**
 * 출구 표지: one quiet mark per exit, on its line away from the node (in the room between frames, or between two nodes),
 * or at the end of the short line an exit that ends the flow draws. The graph is read for where lines go, so the status
 * an exit sets is said in full (→, the status's icon, its name); tags are bookkeeping, so they are a tag icon and how
 * many it puts on and takes off (+1 −7), in muted text. Which tags they are is the mark's hover card and the exit's pane
 * (a click opens it). `selected`: the exit is open in its pane. `label` (a condition's 예/아니요) goes first, in the mark.
 * `compact`: zoomed far out, the icons only.
 */
export function ExitTag({ items, selected, compact, onOpen, exit, label }: {
  items: ExitTagItem[]
  selected?: boolean
  compact?: boolean
  onOpen?: () => void
  /** The exit's name, for the button's accessible name ("통과"). */
  exit?: string
  /** The line's own label (a condition's 예/아니요). */
  label?: string
}) {
  const status = items.findLast((item) => item.kind === "status")
  const tags = items.filter((item) => item.kind === "tag")
  const words = exitTagWords(items)
  const mark = (
    <button
      type="button"
      aria-label={`${exit ?? "출구"} 출구 동작: ${words.join(", ")}`}
      aria-pressed={selected}
      onClick={(event) => { event.stopPropagation(); onOpen?.() }}
      className={cn(
        "nodrag nopan pointer-events-auto flex h-5 max-w-44 items-center gap-1 whitespace-nowrap rounded-full border bg-surface px-1.5 text-xs shadow-2xs outline-none transition-colors hover:border-strong focus-visible:ring-2 focus-visible:ring-focus/40",
        selected ? "border-accent ring-2 ring-accent/30" : "border-default",
      )}
    >
      {label && <span className="text-muted">{label}</span>}
      {status && (
        <span className="flex min-w-0 items-center gap-1 font-medium text-default">
          <ArrowRight className="size-3 shrink-0 text-muted" aria-hidden="true" />
          <StatusIcon status={{ color: status.color ?? "", kind: status.statusKind, inReview: status.inReview }} />
          {!compact && <span className="truncate">{status.name}</span>}
        </span>
      )}
      {status && tags.length > 0 && !compact && <span className="h-3 shrink-0 border-l border-default" aria-hidden="true" />}
      {tags.length > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 tabular-nums text-muted">
          <Tag className="size-3" aria-hidden="true" />
          {!compact && tagCounts(tags)}
        </span>
      )}
    </button>
  )
  // Which tags: the hover card lists every action (a status alone says it all already).
  if (!tags.length) return mark
  return (
    <HoverCard openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>{mark}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-auto min-w-40 max-w-64 p-3"><ExitTagList items={items} /></HoverCardContent>
    </HoverCard>
  )
}

/**
 * An exit's actions as a list (the mark's hover card): the status it sets, then the tags it adds and removes, each group
 * under one heading, each tag the tag's own chip; tags a result decides under the step's name.
 */
export function ExitTagList({ items }: { items: readonly ExitTagItem[] }) {
  const statuses = items.filter((item) => item.kind === "status")
  const group = (action: "add" | "remove") => items.filter((item) => item.kind === "tag" && (item.action ?? "add") === action)
  return (
    <div className="space-y-2 text-xs">
      {statuses.map((item, index) => (
        <p key={index} className="flex items-center gap-1.5 font-medium">
          <ArrowRight className="size-3 text-muted" aria-hidden="true" />
          <StatusIcon status={{ color: item.color ?? "", kind: item.statusKind, inReview: item.inReview }} />
          {item.name}
        </p>
      ))}
      {(["add", "remove"] as const).map((action) => {
        const tags = group(action)
        if (!tags.length) return null
        const picked = tags.filter((item) => !item.fromResult)
        return (
          <div key={action} className="space-y-1">
            <p className="text-muted">{action === "add" ? "추가할 태그" : "제거할 태그"}</p>
            {picked.length > 0 && <div className="flex flex-wrap gap-1">{picked.map((item, index) => <TagChip key={index} tag={{ name: item.name, color: item.color ?? "" }} />)}</div>}
            {tags.filter((item) => item.fromResult).map((item, index) => (
              <div key={`r${index}`} className="space-y-1">
                <p className="text-subtle">{item.name} 결과에 따라</p>
                {item.options?.length
                  ? <div className="flex flex-wrap gap-1">{item.options.map((option, at) => <TagChip key={at} tag={{ name: option.name, color: option.color ?? "" }} />)}</div>
                  : <p className="text-subtle">결과의 값과 같은 이름의 태그</p>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/** On a line no action is on yet, under the pointer: the way to put one there (opens the exit). */
export function ExitTagAdd({ onAdd }: { onAdd?: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onAdd?.() }}
      className="nodrag nopan pointer-events-auto flex size-5 items-center justify-center rounded-full border border-dashed border-accent bg-surface text-xs text-accent shadow-2xs hover:bg-accent-soft"
      aria-label="출구 동작 추가"
      title="출구 동작 추가"
    >
      +
    </button>
  )
}

/** How wide a run of text is at text-xs, near enough to keep room for it: Hangul and wide letters 12px, the rest 7px. */
const textWidth = (text: string) => [...text].reduce((width, char) => width + (/[ᄀ-￿]/.test(char) ? 12 : 7), 0)

/** The room an exit's mark takes on the canvas (the layout keeps it clear on the line): one row. */
export function exitTagSize(items: readonly ExitTagItem[], label?: string): { width: number; height: number } {
  const status = items.findLast((item) => item.kind === "status")
  const tags = items.filter((item) => item.kind === "tag")
  const width = 14 + (label ? textWidth(label) + 4 : 0) + (status ? textWidth(status.name) + 32 : 0) + (tags.length ? textWidth(tagCounts(tags)) + 20 : 0) + (status && tags.length ? 9 : 0)
  return { width: Math.min(176, width), height: 22 }
}
