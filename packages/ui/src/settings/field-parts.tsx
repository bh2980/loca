import type * as React from "react"
import { cn } from "../lib/utils"
import { Input } from "../primitives/input"
import { Label } from "../primitives/label"
import { FieldDescription, FieldGroup } from "../primitives/field"
import { SelectTrigger } from "../primitives/select"
import { Textarea } from "../primitives/textarea"
import { Button } from "../primitives/button"
import { CollapsibleContent } from "../primitives/collapsible"

/** A text field in a monospace face (a path, a header template). `textSize` is its type size: caption (default) or body. */
export function MonoInput({ textSize = "caption", className, ...props }: React.ComponentProps<typeof Input> & { textSize?: "caption" | "body" }) {
  return <Input className={cn("font-mono", textSize === "body" ? "text-sm" : "text-xs", className)} {...props} />
}

/** A long text (a prompt) in a monospace face. */
export function MonoTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea className="font-mono text-xs" {...props} />
}

/** A number field: `field` is a plain 8rem box, `count` a narrow right-aligned box that sits beside a checkbox label. */
export function NumberFieldInput({ width = "field", ...props }: React.ComponentProps<typeof Input> & { width?: "field" | "count" }) {
  return <Input className={width === "count" ? "h-7 w-14 text-right" : "w-32"} {...props} />
}

/** The name of a saved prompt: a short box. */
export function PromptNameInput(props: React.ComponentProps<typeof Input>) {
  return <Input className="max-w-48" {...props} />
}

/** The text of a saved prompt: at least six lines tall. */
export function PromptTextarea(props: React.ComponentProps<typeof Textarea>) {
  return <Textarea className="min-h-24" {...props} />
}

/** A select that fills the width of its field. */
export function FullSelectTrigger(props: React.ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className="w-full" {...props} />
}

/** A checkbox's label in body size and normal weight. */
export function NormalLabel(props: React.ComponentProps<typeof Label>) {
  return <Label className="text-sm font-normal" {...props} />
}

/**
 * A group of settings fields. `gap` is the space between fields (wide 32px, comfortable 16px); `nested` indents it under the switch it
 * belongs to with a rule on its left; `lead` leaves room above it (a group that opens under its trigger).
 */
export function SettingsFieldGroup({ gap = "comfortable", nested, lead, ...props }: React.ComponentProps<typeof FieldGroup> & { gap?: "wide" | "comfortable"; nested?: boolean; lead?: boolean }) {
  return <FieldGroup className={cn(gap === "wide" ? "gap-8" : "gap-4", nested && "border-l border-border-subtle pl-4", lead && "pt-3")} {...props} />
}

/** A note right under the control it explains (touches the control, unlike a field's own description). */
export function FieldNote(props: React.ComponentProps<typeof FieldDescription>) {
  return <FieldDescription className="mt-1" {...props} />
}

/** A label in a fixed 4rem column, so the rows of a list line up. */
export function FixedLabel(props: React.ComponentProps<"span">) {
  return <span className="w-16 shrink-0" {...props} />
}

/** What opens under a row of instructions: the text, a little way below the row. */
export function InstructionsBody(props: React.ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className="pt-2" {...props} />
}

/** A ghost button that opens a section, pulled left so its label lines up with the fields (pair with a turning chevron). */
export function DisclosureButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" className="group -ml-2" {...props} />
}

/** A value and the button that clears it, in one row no wider than a form field. The value takes the room. */
export function ClearableFieldRow(props: React.ComponentProps<"div">) {
  return <div className="flex max-w-md items-center gap-2" {...props} />
}

/** The column of saved prompts: reading width, rows 8px apart. */
export function SavedPromptColumn(props: React.ComponentProps<"div">) {
  return <div className="max-w-2xl space-y-2" {...props} />
}
