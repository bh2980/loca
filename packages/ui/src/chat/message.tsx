import type * as React from "react"
import { X } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "../primitives/button"

const BUBBLE = "rounded-lg bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs ring-1 ring-border"

/** What the person wrote: a bubble indented from the left, with the message's actions (`MessageActionBar`) under it. */
export function UserMessage({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="group/message ml-8">
      <div className={BUBBLE}>{children}</div>
      {actions}
    </div>
  )
}

/** What the agent answered: its blocks (text, tool calls, cards) one under the other. A `group/message` for the actions that show on hover. */
export function AssistantMessage({ children }: { children: React.ReactNode }) {
  return <div className="group/message space-y-2 text-sm">{children}</div>
}

/** Copy / reuse buttons under a message; shown on hover or keyboard focus of the message. */
export function MessageActionBar({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">{children}</div>
}

/** A message sent while a reply was running: where the reply took it, or (`waiting`) still waiting for its next step. `actions` sit beside the label. */
export function SteerBubble({ label, waiting = false, actions, children }: { label: React.ReactNode; waiting?: boolean; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("ml-8", BUBBLE, waiting && "text-muted-foreground")}>
      <span className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="flex-1">{label}</span>
        {actions}
      </span>
      {children}
    </div>
  )
}

/** A picture the person pasted, in the box before sending: dimmed when the model cannot read pictures, removable. */
export function ImageChip({ src, alt, dimmed = false, removeLabel, onRemove }: { src: string; alt: string; dimmed?: boolean; removeLabel: string; onRemove: () => void }) {
  return (
    <span className={cn("relative inline-block rounded-md ring-1 ring-border", dimmed && "opacity-50")}>
      <img src={src} alt={alt} className="size-12 rounded-md object-cover" />
      <Button variant="secondary" size="inline" aria-label={removeLabel} className="absolute -top-1.5 -right-1.5 rounded-full p-0.5" onClick={onRemove}>
        <X />
      </Button>
    </span>
  )
}

/** A picture a sent message carried. */
export function SentImage({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="max-h-40 max-w-full rounded-md ring-1 ring-border" />
}
