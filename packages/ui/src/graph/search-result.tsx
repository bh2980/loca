import type * as React from "react"
import { Button } from "../primitives/button"

/** A found line under the graph's search box: two lines (the text, where it is), rows divided by a hairline. */
export function SearchResultButton(props: Omit<React.ComponentProps<typeof Button>, "variant" | "className">) {
  return <Button variant="ghost" className="flex h-auto w-full min-w-0 flex-col items-start rounded-none border-b border-border px-2 py-1.5 text-left text-sm last:border-b-0" {...props} />
}
