import { CircleAlert } from "lucide-react"
import type * as React from "react"
import { Icon } from "../../primitives/icon"
import { Inline } from "../../primitives/stack"

/** A finding in warning colour with its icon; put in a list of findings. */
export function DetailIssue({ children }: { children?: React.ReactNode }) {
  return (
    <Inline as="li" align="start" gap="snug">
      <Icon icon={CircleAlert} size="sm" marginTop="hair" shrink={false} />
      {children}
    </Inline>
  )
}
