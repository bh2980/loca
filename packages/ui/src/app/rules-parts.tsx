import type * as React from "react"
import type { ReactNode } from "react"
import { Box } from "../layout/box"
import { Stack } from "../layout/stack"
import { cn } from "../lib/utils"
import { Badge } from "../primitives/badge"
import { Button, type ButtonProps } from "../primitives/button"
import { Input } from "../primitives/input"
import { SelectTrigger } from "../primitives/select"
import { Text } from "../primitives/text"
import { Textarea } from "../primitives/textarea"

/** A warning strip above a form: what happened, and the choices that settle it (an edit whose item changed elsewhere). */
export function RulesWarningBanner({ message, actions }: { message: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
      <Text tone="warning">{message}</Text>
      <Stack as="span" direction="row" gap="tight" marginLeft="auto">
        {actions}
      </Stack>
    </div>
  )
}

const INPUT_ROLE = {
  /** A rule's name: a short fixed width. */
  name: "w-32",
  /** A rule's pattern: takes the row's room, monospaced. */
  pattern: "flex-1 font-mono text-sm",
  /** A sentence to describe a rule: takes the row's room. */
  prompt: "flex-1",
  /** A sample text to try rules on: monospaced, on the box's own surface. */
  sample: "bg-background font-mono text-sm",
} as const

/** A text field of a rules form, shaped by its role. */
export function RulesInput({ role, ...props }: React.ComponentProps<typeof Input> & { role: keyof typeof INPUT_ROLE }) {
  return <Input className={INPUT_ROLE[role]} {...props} />
}

/** The multi-line sample to try rules on: monospaced, on the box's own surface. */
export function RulesSampleTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea className="min-h-16 bg-background font-mono text-sm" {...props} />
}

/** The select that picks a rule's kind, a fixed width. */
export function RulesKindSelectTrigger(props: React.ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className="w-28" {...props} />
}

/** A card with a checkbox and what it stands for; the whole card toggles it (a preset of format rules). */
export function RulesPresetCard(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="flex cursor-pointer flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-sm transition-colors hover:bg-muted/50" {...props} />
}

/** Preset cards in two columns from the small breakpoint up, one below. */
export function RulesPresetGrid(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="grid gap-2 sm:grid-cols-2" {...props} />
}

/**
 * The monospaced example line of a preset card, under its checkbox. With `found` examples it says `lead` (in the normal font) and then
 * lists them; otherwise it shows `fallback`.
 */
export function RulesPresetExample({ lead, found, fallback }: { lead: ReactNode; found: string[]; fallback: ReactNode }) {
  return (
    <Box paddingLeft="spacious" mono variant="caption" tone="muted" truncate>
      {found.length > 0 ? (
        <>
          <span className="font-sans text-subtle-foreground">{lead} </span>
          {found.join("   ")}
        </>
      ) : (
        fallback
      )}
    </Box>
  )
}

/** A count badge of a card or a suggestion; `endAligned` pushes it to the end of its row. */
export function RulesCountBadge({ endAligned, ...props }: React.ComponentProps<typeof Badge> & { endAligned?: boolean }) {
  return <Badge variant="secondary" className={cn(endAligned && "ml-auto")} {...props} />
}

/** The panel of suggested rules found in the script, on a faint surface. */
export function RulesSuggestionPanel(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3" {...props} />
}

/** One suggested rule: what it is on the left, its add button on the right. */
export function RulesSuggestionRow(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-background/50 px-2.5 py-1.5 text-sm" {...props} />
}

/** The small outline button that adds a suggestion (24px tall, 12px text). */
export function RulesAddButton(props: Omit<ButtonProps, "variant" | "size" | "className">) {
  return <Button variant="outline" className="h-6 px-2 text-xs" {...props} />
}

/** A quiet underlined link in a header; give it the one link element as its child (a router link), which takes the look. */
export function RulesQuietLink({ children }: { children: ReactNode }) {
  return (
    <Text asChild variant="caption" tone="muted" underline="offset" className="hover:text-foreground">
      {children}
    </Text>
  )
}
