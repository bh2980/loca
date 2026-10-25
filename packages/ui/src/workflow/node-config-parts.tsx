import type { LucideIcon } from "lucide-react"
import { ChevronRight } from "lucide-react"
import type * as React from "react"
import { Inspector, type InspectorProps } from "../inspector/inspector"
import { NODE_CARD_KIND_APPEARANCE } from "../canvas/node-card"
import { Box } from "../layout/box"
import { Inline } from "../layout/stack"
import { Button, type ButtonProps } from "../primitives/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../primitives/dialog"
import { Select, SelectContent, SelectTrigger, SelectValue } from "../primitives/select"
import { TagChip } from "../tokens/status"
import { cn } from "../lib/utils"

/** A select that fills the width of its field: the trigger with the chosen value, the choices (`children`: SelectItem) in the list. */
export function SelectField({ value, onValueChange, ariaLabel, children }: { value?: string; onValueChange?: (value: string) => void; ariaLabel?: string; children: React.ReactNode }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full" aria-label={ariaLabel}><SelectValue /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  )
}

/** A node's icon in the color of its kind (the same colors as the node on the canvas). */
export function NodeKindIcon({ icon: Glyph, kind }: { icon: LucideIcon; kind: keyof typeof NODE_CARD_KIND_APPEARANCE }) {
  return <Glyph className={cn("size-3.5", NODE_CARD_KIND_APPEARANCE[kind].icon)} />
}

/** The inspector of a workflow node: the shared inspector shell without its own left line and body padding (the sections carry their own). */
export function NodeInspector(props: Omit<InspectorProps, "className" | "bodyClassName">) {
  return <Inspector className="min-w-0 border-l-0" bodyClassName="space-y-0 p-0" {...props} />
}

/** The settings of a node as one group that can be switched off together (read-only). */
export function NodeFieldset({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  return <fieldset disabled={disabled} className="min-w-0">{children}</fieldset>
}

/** A dialog that shows one thing large (a long text, a prompt): a title and the content filling the rest of the height. */
export function LargeDialog({ open, onOpenChange, title, size = "md", children }: { open: boolean; onOpenChange: (open: boolean) => void; title: React.ReactNode; size?: "md" | "lg"; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={size === "lg" ? "flex h-[85vh] max-w-4xl flex-col" : "flex h-[75vh] max-w-3xl flex-col"}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** A field of a JSON field list read as a row: pulled out past the padding, it highlights on hover and takes a focus ring (it opens the field for editing). */
export function FieldReadRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("-mx-1.5 min-w-0 cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none", className)} {...props} />
}

/** The fields of a list field, one step in behind a guide line that is darker while one of them is being edited. */
export function FieldChildren({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <div className={cn("mt-1 ml-1.5 border-l-2 pl-2.5", active ? "border-muted-foreground" : "border-muted-foreground/30")}>{children}</div>
}

/**
 * A tag chip that is a toggle: faint until picked (`faint`), with the `sign` (+ / −) before it once it has a state, struck through when
 * `struck` (it will be taken off). The chip itself is the button.
 */
export function TagToggle({ tag, sign, faint, struck, ...props }: Omit<ButtonProps, "children" | "variant" | "size"> & { tag: { name: string; color: string }; sign?: string; faint?: boolean; struck?: boolean }) {
  return (
    <Button variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" {...props}>
      {sign && <span className="text-xs text-muted-foreground">{sign}</span>}
      <TagChip tag={tag} className={cn(faint && "opacity-50 hover:opacity-100", struck && "line-through")} />
    </Button>
  )
}

/** One folded part of a request's details: its name and size are visible, the content opens on demand. */
export function RequestPart({ title, size, children }: { title: string; size: React.ReactNode; children: React.ReactNode }) {
  return (
    <Collapsible className="border-b border-border-subtle last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 py-2 text-left text-sm">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        <span className="font-medium">{title}</span>
        <span className="ml-auto truncate pl-2 text-xs text-muted-foreground tabular-nums">{size}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3 pl-5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The folded 상세 of a request: a small heading that opens the parts (`RequestPart`). */
export function RequestDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-semibold">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  )
}
