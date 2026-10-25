import { Badge, type BadgeProps } from "../primitives/badge"
import { Input } from "../primitives/input"
import { PopoverContent } from "../primitives/popover"
import { SelectTrigger } from "../primitives/select"
import { Skeleton } from "../primitives/skeleton"
import { Textarea } from "../primitives/textarea"
import { cn } from "../lib/utils"
import { SplitPane, type SplitPaneProps } from "../layout/split-pane"
import type * as React from "react"

/** A select's trigger that fills the width of its field. */
export function KnowledgeSelectTrigger(props: Omit<React.ComponentProps<typeof SelectTrigger>, "className">) {
  return <SelectTrigger className="w-full" {...props} />
}

/** A text field for a code-like value (a line key): monospace, body size. */
export function KnowledgeCodeInput(props: Omit<React.ComponentProps<typeof Input>, "className">) {
  return <Input className="font-mono text-sm" {...props} />
}

/** A long text field in reading size; `mono` for text that is markup (a note's body). */
export function KnowledgeTextarea({ mono, ...props }: Omit<React.ComponentProps<typeof Textarea>, "className"> & { mono?: boolean }) {
  return <Textarea className={cn(mono && "font-mono", "text-sm leading-relaxed")} {...props} />
}

/** The popover of the add-a-pair form: a column of fields, 20rem wide. */
export function KnowledgePairPopoverContent(props: Omit<React.ComponentProps<typeof PopoverContent>, "className">) {
  return <PopoverContent className="grid w-80 gap-3" {...props} />
}

/** A small outline badge after a name (플레이어). */
export function KnowledgeNameBadge(props: Omit<BadgeProps, "variant" | "className">) {
  return <Badge variant="outline" className="ml-2" {...props} />
}

/** The warning outline badge on an item the app marked for a look (확인 권장); `title` carries the reasons. */
export function KnowledgeReviewBadge(props: Omit<BadgeProps, "variant" | "className">) {
  return <Badge variant="outline" className="border-warning text-warning" {...props} />
}

/** A single muted line in a table cell that ends in an ellipsis. */
export function KnowledgeSummaryText({ children }: { children: React.ReactNode }) {
  return <span className="line-clamp-1 text-muted-foreground">{children}</span>
}

/** The placeholder shown while a graph (`graph`, 16rem) or the event flow (`timeline`, 10rem) loads. */
export function KnowledgeLoadingBlock({ kind }: { kind: "graph" | "timeline" }) {
  return <Skeleton className={kind === "graph" ? "m-4 h-64" : "m-4 h-40"} />
}

/** The split pane of a full-height knowledge page: the table on the left, the item's pane on the right. */
export function KnowledgeSplitPane(props: Omit<SplitPaneProps, "className">) {
  return <SplitPane className="h-full" {...props} />
}
