import { Slot } from "@radix-ui/react-slot"
import { CircleAlert } from "lucide-react"
import type * as React from "react"
import { Group } from "../primitives/heading"
import { InspectorList } from "../inspector/inspector-field"
import { SelectTrigger } from "../primitives/select"

/** The title of a dialogue line's pane: the speaker, and `→ listener` when it is known. */
export function DetailDialogueTitle({ speaker, listener }: { speaker: React.ReactNode; listener?: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{speaker}</span>
      {listener && (
        <>
          <span className="text-subtle-foreground">→</span>
          <span className="truncate">{listener}</span>
        </>
      )}
    </span>
  )
}

/** The line's key, in code type, breaking anywhere. */
export function DetailLineKey({ children }: { children?: React.ReactNode }) {
  return <code className="min-w-0 flex-1 pt-1 font-mono text-xs break-all text-muted-foreground">{children}</code>
}

/** A link row that starts with an icon and its text (puts its options on the one child, the link). */
export function DetailIconLink({ children }: { children: React.ReactNode }) {
  return <Slot className="flex min-w-0 items-center gap-1.5 hover:underline">{children}</Slot>
}

/** The select of a pane's field, as wide as the field. */
export function DetailSelectTrigger(props: React.ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger {...props} className="w-full" />
}

/** A finding in warning colour with its icon; put in a list of findings. */
export function DetailIssue({ children }: { children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </li>
  )
}

/** A titled group of candidates, a little looser than a plain group. */
export function DetailCandidateGroup({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return <Group title={title} className="space-y-2">{children}</Group>
}

/** The runs list of a line's history, in body type. */
export function DetailHistoryList({ children }: { children: React.ReactNode }) {
  return <InspectorList className="text-sm">{children}</InspectorList>
}
