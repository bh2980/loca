import * as React from "react"

/** A card that floats beside its graph node (not a modal: the graph stays usable around it). Takes the focus itself (`tabIndex={-1}`) so its keys work. */
export const FloatingCard = React.forwardRef<HTMLDivElement, Omit<React.ComponentProps<"div">, "className">>((props, ref) => (
  <div ref={ref} className="flex flex-col gap-2 rounded-lg border bg-overlay outline-none p-3 text-default shadow-lg" {...props} />
))
FloatingCard.displayName = "FloatingCard"
