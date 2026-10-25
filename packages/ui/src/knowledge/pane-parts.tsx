import { Slot } from "@radix-ui/react-slot"
import { clsx } from "clsx"
import { ChevronRight } from "lucide-react"
import type * as React from "react"
import { InspectorList } from "../inspector/inspector-field"
import { Button, type ButtonProps } from "../primitives/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../primitives/collapsible"
import { Icon } from "../primitives/icon"

/**
 * A list that stays folded until asked for (a rule's lines, evidence inside a pair): a quiet trigger with a turning arrow. Controlled by
 * `open`.
 */
export function KnowledgeFold({ label, open, onOpenChange, children }: { label: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="inline" tone="muted" className="-ml-1">
          <Icon icon={ChevronRight} turn={open} /> {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The row above a small group in a pane: its heading on the left, actions after it (`spread` pushes them to the far end). */
export function KnowledgeSubheadRow({ spread, children }: { spread?: boolean; children: React.ReactNode }) {
  return <div className={clsx("flex min-h-7 items-center gap-2", spread && "justify-between")}>{children}</div>
}

const LINE_LINK = {
  /** A line in a list, filling the row. */
  row: "block py-1.5 text-sm hover:bg-muted",
  /** The same, inset from the list's edge. */
  inset: "block px-1 py-1.5 text-sm hover:bg-muted",
  /** A quoted line under a change, muted until hovered. */
  quote: "mt-1 block text-muted-foreground hover:underline",
} as const

/** A link to a script line (the one child, e.g. a router link) styled as a row of a list. */
export function KnowledgeLineLink({ kind = "row", children }: { kind?: keyof typeof LINE_LINK; children: React.ReactElement }) {
  return <Slot className={LINE_LINK[kind]}>{children}</Slot>
}

/** A list of rows that scrolls past a limit (Tailwind steps: 60 is 15rem, 64 is 16rem). */
export function KnowledgeScrollList({ limit, children }: { limit: 60 | 64; children: React.ReactNode }) {
  return <InspectorList className={limit === 60 ? "max-h-60 overflow-auto" : "max-h-64 overflow-auto"}>{children}</InspectorList>
}

/** One row of an `InspectorList` of rules or changes: `tight` is a rule (py-1), `loose` a change (py-2, body text). The first and last sit flush. */
export function KnowledgeListItem({ density = "tight", children }: { density?: "tight" | "loose"; children: React.ReactNode }) {
  return <li className={density === "tight" ? "py-1 first:pt-0 last:pb-0" : "py-2 text-sm first:pt-0 last:pb-0"}>{children}</li>
}

/** A quiet button that is a whole row of a list (pick one of the lines), in body text. */
export function KnowledgeRowButton(props: Omit<ButtonProps, "variant" | "size" | "className">) {
  return <Button variant="ghost" size="row" className="text-sm" {...props} />
}

/** The arrow between two items of a wrapped row, centred on the row. */
export function KnowledgeArrow({ children }: { children: React.ReactNode }) {
  return <span className="self-center text-muted-foreground">{children}</span>
}

/** A status line's parts side by side inline (an icon and its name, a name and a mark): `tight` 4px, `snug` 6px apart. */
export function KnowledgeInlineFlex({ gap = "snug", children }: { gap?: "tight" | "snug"; children: React.ReactNode }) {
  return <span className={gap === "tight" ? "inline-flex items-center gap-1" : "inline-flex items-center gap-1.5"}>{children}</span>
}
