import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import type * as React from "react"
import { cn } from "../lib/utils"
import { type StyleProps, splitStyle, styleVariants } from "../primitives/style"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

/**
 * What opens: it stays in the page as an empty hidden element while folded (so a screen's structure does not change with it). Space
 * around it is a prop (`paddingTop`, `marginTop`, ...), by name.
 */
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & Pick<StyleProps, "paddingTop" | "paddingBottom" | "paddingLeft" | "marginTop">) {
  const [style, rest] = splitStyle(props)
  return <CollapsiblePrimitive.CollapsibleContent className={cn(styleVariants(style), className) || undefined} {...rest} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
