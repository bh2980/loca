import { useEffect, useRef, useState, type ReactNode } from "react"
import { MoreHorizontal, Pencil, Trash2, Ungroup } from "lucide-react"
import { Button } from "../../controls/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "../../controls/dropdown-menu"
import { Input } from "../../controls/input"

/** The room a frame keeps around its nodes: its header above them, and the same margin on every other side. */
export const FRAME_PAD = 32
export const FRAME_HEADER = 32

/**
 * A step of a workflow drawn as a box (번역 · 자동 검사 · AI 검수 …): its name, how many nodes it holds, and in a run's graph
 * how its lines are doing. It sits behind the nodes at the size the page gives it. Only its header takes the pointer
 * (`data-frame-handle`: the page drags the frame by it and picks it with a click); the room inside lets clicks through.
 *
 * In the editor it also takes `onRename` (the pencil shown on the header, the menu, or a double-click on the name; the
 * page can open it with `renaming`, and hears `onRenamed` once the field closes), `onUngroup` (프레임만 삭제: the nodes stay)
 * and `onDelete` (삭제: the frame and the nodes in it, as Figma deletes a section with its contents); `selected` rings it as a picked node is, and `over` while nodes dragged onto it would join it.
 */
export function WorkflowFrame({ label, meta, live, over, selected, renaming, onRename, onRenamed, onUngroup, onDelete, ungroupKey }: {
  label: string
  meta?: string
  live?: ReactNode
  over?: boolean
  selected?: boolean
  /** Opens the name field (a frame just made, or 이름 바꾸기 from elsewhere). */
  renaming?: boolean
  onRename?: (label: string) => void
  onRenamed?: () => void
  onUngroup?: () => void
  onDelete?: () => void
  /** The shortcut shown beside 프레임만 삭제, in the platform's words. */
  ungroupKey?: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  // Esc closes the field, and the blur that follows must not keep what was typed.
  const cancelled = useRef(false)
  const start = () => {
    cancelled.current = false
    setEditing(label)
  }
  useEffect(() => {
    if (renaming && onRename) start()
  }, [renaming]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = (keep: boolean) => {
    if (!keep) cancelled.current = true
    if (keep && !cancelled.current && editing !== null && editing.trim() !== label) onRename?.(editing.trim())
    setEditing(null)
    onRenamed?.()
  }
  // Only the header stands over the lines (it must take the pointer where a line crosses it). The edge, the shade, the
  // picked ring and the drop wash are WorkflowFrameTint's, under the lines, so a line crossing the edge is not cut by it;
  // the transparent edge here keeps the header inside the drawn one.
  return (
    <div className="size-full rounded-lg border-2 border-transparent">
      <div
        data-frame-handle
        className={"group/frame pointer-events-auto flex items-center gap-1.5 rounded-t-lg border-b border-subtle px-2 text-xs " + (onRename ? "cursor-grab active:cursor-grabbing " : "") + (selected ? "bg-accent-soft" : "bg-surface")}
        style={{ height: FRAME_HEADER }}
      >
        {editing !== null ? (
          <Input
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
            onBlur={() => done(true)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") done(true)
              else if (event.key === "Escape") done(false)
            }}
            placeholder="단계 이름"
            aria-label="프레임 이름"
            className="nodrag nopan h-6 w-48 cursor-text px-1.5 text-xs"
          />
        ) : (
          <>
            <span className="min-w-0 truncate font-semibold text-default" onDoubleClick={onRename ? start : undefined}>
              {label || "이름 없는 프레임"}
            </span>
            {onRename && (
              <Button variant="ghost" size="icon-xs" aria-label="프레임 이름 바꾸기" title="이름 바꾸기" onClick={start} className="nodrag nopan text-muted opacity-0 group-hover/frame:opacity-100 focus-visible:opacity-100">
                <Pencil />
              </Button>
            )}
          </>
        )}
        {meta && <span className="shrink-0 text-subtle">{meta}</span>}
        {live && <span className="ml-auto flex shrink-0 gap-2 tabular-nums">{live}</span>}
        {(onRename || onUngroup) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="프레임 메뉴" className={"nodrag nopan text-muted " + (live ? "" : "ml-auto")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onRename && <DropdownMenuItem onSelect={start}><Pencil />이름 바꾸기</DropdownMenuItem>}
              {onUngroup && <DropdownMenuItem onSelect={onUngroup}><Ungroup />프레임만 삭제 · 노드는 남음{ungroupKey && <DropdownMenuShortcut>{ungroupKey}</DropdownMenuShortcut>}</DropdownMenuItem>}
              {onDelete && <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />삭제 · 안의 노드까지<DropdownMenuShortcut>Delete</DropdownMenuShortcut></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

/** A frame's edge and the shade of its room, drawn under the lines (only the frame's header stands over them), at the frame's size. */
export function WorkflowFrameTint({ selected, over }: { selected?: boolean; over?: boolean }) {
  // Picked: ringed as a picked node is. A drop target: the accent edge, dashed, over a wash.
  const ring = over ? "border-dashed border-accent bg-accent-soft/40" : selected ? "border-accent bg-surface/70 ring-2 ring-accent/30" : "border-default bg-surface/70"
  return <div className={"size-full rounded-lg border-2 " + ring} />
}

/** The lines' colours, once, at the canvas's corner: the main way, 실패, 오류, a line going back. */
export function EdgeLegend() {
  const line = (label: string, stroke: string, dashed?: boolean) => (
    <span className="flex items-center gap-1">
      <svg width="16" height="4" aria-hidden="true"><line x1="0" y1="2" x2="16" y2="2" stroke={stroke} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} /></svg>
      {label}
    </span>
  )
  return (
    <div className="flex items-center gap-3 rounded-md border border-default bg-overlay px-2 py-1 text-xs text-muted shadow-xs">
      {line("흐름", "var(--stroke-graph-edge)")}
      {line("실패", "var(--stroke-warning)")}
      {line("오류", "var(--stroke-danger)")}
      {line("되돌아감", "var(--stroke-accent)", true)}
    </div>
  )
}
