import { Slot } from "@radix-ui/react-slot"
import { CircleAlert, StickyNote, X } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../../lib/utils"
import { Button } from "../../controls/button"
import { Icon } from "../../primitives/icon"
import { Stack } from "../../primitives/stack"
import { Text } from "../../primitives/text"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../controls/tooltip"
import { SceneSectionHeader } from "./scene-section-header"

/** The scene's title row between lines (a list item), with its select-all checkbox and a trailing action shown on hover. */
export function ScriptSceneRow({ title, count, checkbox, trailing }: { title: ReactNode; count?: ReactNode; checkbox?: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="group/scene mx-3 my-3 select-none">
      <SceneSectionHeader title={title} count={count} checkbox={checkbox} trailing={trailing} />
    </li>
  )
}

/** What the last run flagged on a line, under its translation. */
export function ScriptReviewIssue({ issue }: { issue: string }) {
  return (
    <Stack as="p" direction="row" align="start" gap="tight" marginTop="tight" variant="caption" tone="warning">
      <Icon icon={CircleAlert} size="xs" marginTop="hair" shrink={false} />
      <Text lines={2}>{issue}</Text>
    </Stack>
  )
}

/** An invisible point where a right-click menu opens (the pointer's place). */
export function ScriptMenuAnchor({ x, y, ...props }: Omit<ComponentProps<"span">, "className"> & { x: number; y: number }) {
  return <span aria-hidden {...props} className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
}

/**
 * The look of a line's source text, put on the one text element inside: the open line reads larger; `tone` says what the line is
 * (`narration` is muted like a stage direction, `document` reads as prose).
 */
export function ScriptSourceStyle({ open, tone, children }: { open: boolean; tone?: "narration" | "document"; children: ReactNode }) {
  const toneClass = tone === "narration" ? "text-muted" : tone === "document" ? "leading-relaxed" : undefined
  return <Slot className={cn(open && "text-base leading-6", toneClass)}>{children}</Slot>
}

/** A person's note on a line, shown as a button that opens it for editing. */
export function ScriptNoteCard({ note, onClick, onDelete }: { note: string; onClick: () => void; /** Given, a delete button shows at the card's corner on hover or focus. */ onDelete?: () => void }) {
  return (
    <div className="group/note relative mt-2">
      <Button variant="ghost" size="row" className={cn("h-auto items-start gap-1 rounded-md border border-warning/30 bg-warning/5 py-2 text-left text-sm font-normal whitespace-pre-wrap", onDelete && "pr-9")} onClick={onClick}>
        <Icon icon={StickyNote} size="sm" marginTop="hair" shrink={false} tone="warning" />
        <span className="min-w-0 break-words">{note}</span>
      </Button>
      {onDelete && (
        <Button variant="ghost" size="icon-xs" aria-label="메모 삭제" title="메모 삭제" className="absolute top-1.5 right-1.5 text-muted opacity-0 hover:text-danger group-hover/note:opacity-100 focus-visible:opacity-100" onClick={onDelete}>
          <X />
        </Button>
      )}
    </div>
  )
}

/** A note's mark beside a speaker; the note itself on hover. */
export function ScriptNoteMark({ note }: { note: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Icon icon={StickyNote} size="sm" shrink={false} tone="warning" aria-label="메모 있음" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-sm whitespace-pre-wrap">{note}</TooltipContent>
    </Tooltip>
  )
}
