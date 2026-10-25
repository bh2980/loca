import { Slot } from "@radix-ui/react-slot"
import type { ReactElement } from "react"

/** The look of a React Flow handle (a connection point), by what it is. */
const LOOK = {
  /** A workflow node's input or a normal output port. */
  workflow: "!size-2.5 !border-2 !border-surface !bg-neutral",
  /** An output port for a retry / failure path. */
  "workflow-warning": "!size-2.5 !border-2 !border-surface !bg-warning",
  /** An output port for an error path. */
  "workflow-danger": "!size-2.5 !border-2 !border-surface !bg-danger",
  /** An invisible target a floating edge attaches to (a person card's top). */
  anchor: "!top-1/2 !size-1 !border-0 !opacity-0",
  /** A person card's dot to drag a relationship from, with a wider grab area. */
  person: "!size-2.5 !border-2 !border-surface !bg-neutral after:absolute after:-inset-2 after:content-[''] hover:!bg-accent group-hover/person:!bg-accent",
  /** An event card's dot to drag a link from. */
  event: "!size-3 !border-2 !border-surface !bg-neutral after:absolute after:-inset-3 after:content-[''] hover:!bg-accent group-hover/event:!bg-accent",
  /** An event card's dot that can not start a link: hidden. */
  "event-idle": "!opacity-0",
  /** A handle that only anchors edges: invisible and not clickable. */
  hidden: "!pointer-events-none !opacity-0",
} as const

export type FlowHandleLook = keyof typeof LOOK

/** Gives the one `Handle` inside it its look by name: `<FlowHandle look="workflow"><Handle type="target" .../></FlowHandle>`. */
export function FlowHandle({ look, children }: { look: FlowHandleLook; children: ReactElement }) {
  return <Slot className={LOOK[look]}>{children}</Slot>
}
