import { Slot } from "@radix-ui/react-slot"
import { Check, CircleAlert, StickyNote } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"
import { Button } from "../primitives/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../primitives/tooltip"
import { StatusIcon } from "../tokens/status"
import { SceneSectionHeader } from "./scene-section-header"
import { TranslationRow } from "./translation-row"

/** A small bordered chip under a line's source (a result of the last run). `ok`: true shows a check, false a warning, null nothing. */
export function ScriptHintChip({ ok, title, children }: { ok: boolean | null; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs shadow-2xs", ok === false && "border-warning/40 text-warning")}>
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      {children}
    </span>
  )
}

/** A confirmed term as a button: source → target. `ok`: the draft holds the target (true), lacks it (false), or is empty (null). */
export function ScriptTermChip({ ok, source, target, title, onClick }: { ok: boolean | null; source: string; target: string; title?: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="inline"
      title={title}
      onClick={onClick}
      className={cn("h-auto gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-normal shadow-2xs hover:bg-accent", ok === false && "border-warning/40 text-warning")}
    >
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      <span>{source}</span>
      <span className="text-subtle-foreground">→</span>
      <span className="font-medium">{target}</span>
    </Button>
  )
}

/** The speech rule written out under a line's source. `state`: kept (check), broken (warning icon and color), or just stated. */
export function ScriptSpeechRule({ state, children }: { state: "kept" | "broken" | "plain"; children: ReactNode }) {
  return (
    <p className={cn("flex items-start gap-1 text-xs", state === "broken" ? "text-warning" : "text-muted-foreground")}>
      {state === "kept" && <Check className="mt-0.5 size-3 shrink-0 text-success" />}
      {state === "broken" && <CircleAlert className="mt-0.5 size-3 shrink-0" />}
      {children}
    </p>
  )
}

/** One line of what is known about the speaker (habit, relationship), cut to a single line. */
export function ScriptSpeakerFact({ title, children }: { title?: string; children: ReactNode }) {
  return <p className="line-clamp-1 text-xs text-muted-foreground" title={title}>{children}</p>
}

/** A chip-sized button that filters the list by what it shows (a mark, a tag); no padding of its own. */
export function ScriptChipButton(props: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return <Button variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" {...props} />
}

/** The scene's title row between lines (a list item), with its select-all checkbox and a trailing action shown on hover. */
export function ScriptSceneRow({ title, count, checkbox, trailing }: { title: ReactNode; count?: ReactNode; checkbox?: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="group/scene mx-3 my-3 select-none">
      <SceneSectionHeader title={title} count={count} checkbox={checkbox} trailing={trailing} className="rounded-md bg-muted/50 py-2.5 text-sm ring-1 ring-inset ring-border" />
    </li>
  )
}

/** A line's speaker row: the speaker (or key), and the mark that says this line is a find match. */
export function ScriptRowIdentity({ found, findLabel, children }: { found?: boolean; findLabel?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {children}
      {found && <span className="shrink-0 text-warning">● {findLabel}</span>}
    </div>
  )
}

/** A line's status as an icon and its name, in the translation column's head. */
export function ScriptRowStatus({ status }: { status: ComponentProps<typeof StatusIcon>["status"] & { name: string } | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <StatusIcon status={status} />
      <span className="truncate">{status?.name}</span>
    </span>
  )
}

/** The translation column of a line that has none yet. */
export function ScriptUntranslated() {
  return <span className="text-subtle-foreground select-none">미번역</span>
}

/** What the last run flagged on a line, under its translation. */
export function ScriptReviewIssue({ issue }: { issue: string }) {
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-warning">
      <CircleAlert className="mt-0.5 size-3 shrink-0" />
      <span className="line-clamp-2">{issue}</span>
    </p>
  )
}

/** The two-language row of a line. `selected`: the open line; otherwise it is clickable. `flagged`: a find match. */
export function ScriptTranslationRow({ selected = false, flagged, ...props }: Omit<ComponentProps<typeof TranslationRow>, "className"> & { flagged?: boolean }) {
  return <TranslationRow {...props} selected={selected} className={cn(selected ? "bg-selection" : "cursor-pointer hover:bg-accent", flagged && !selected && "bg-warning/5")} />
}

/** The list item that holds a line's row. `selected`: the open line; otherwise it is clickable. `flagged`: a find match. */
export function ScriptListItem({ selected, flagged, ...props }: ComponentProps<"li"> & { selected: boolean; flagged?: boolean }) {
  return <li {...props} className={cn("transition-colors", selected ? "bg-selection" : "cursor-pointer", flagged && !selected && "bg-warning/5")} />
}

/** An invisible point where a right-click menu opens (the pointer's place). */
export function ScriptMenuAnchor({ x, y, ...props }: ComponentProps<"span"> & { x: number; y: number }) {
  return <span aria-hidden {...props} className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
}

/**
 * The look of a line's source text, put on the one text element inside: the open line reads larger; `tone` says what the line is
 * (`narration` is muted like a stage direction, `document` reads as prose).
 */
export function ScriptSourceStyle({ open, tone, children }: { open: boolean; tone?: "narration" | "document"; children: ReactNode }) {
  const toneClass = tone === "narration" ? "text-muted-foreground" : tone === "document" ? "leading-relaxed" : undefined
  return <Slot className={cn(open && "text-base leading-6", toneClass)}>{children}</Slot>
}

/** A person's note on a line, shown as a button that opens it for editing. */
export function ScriptNoteCard({ note, onClick }: { note: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="row" className="mt-2 h-auto items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 py-1.5 text-left text-sm font-normal whitespace-pre-wrap" onClick={onClick}>
      <StickyNote className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 break-words">{note}</span>
    </Button>
  )
}

/** A note's mark beside a speaker; the note itself on hover. */
export function ScriptNoteMark({ note }: { note: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StickyNote className="size-3.5 shrink-0 text-warning" aria-label="메모 있음" />
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-sm whitespace-pre-wrap">{note}</TooltipContent>
    </Tooltip>
  )
}
