import type * as React from "react"
import type { ReactNode } from "react"
import { cn } from "../lib/utils"
import { Button } from "../primitives/button"

/** The box of a chip field: chips and the text input wrap inside one bordered field; `focused` draws the focus ring around all of it. */
export function ChipField({ focused, ...props }: React.HTMLAttributes<HTMLDivElement> & { focused: boolean }) {
  return (
    <div
      className={cn("flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm shadow-xs", focused && "border-ring ring-[3px] ring-ring/50")}
      {...props}
    />
  )
}

/** One value of a chip field, with room at its right for the remove button. */
export function ChipTag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-0.5 rounded bg-muted py-0.5 pr-0.5 pl-2 text-xs">{children}</span>
}

/** The bare text input at the end of a chip field: it takes the room that is left. */
export function ChipTextInput(props: React.ComponentProps<"input">) {
  return <input className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground" {...props} />
}

/** The list of suggestions under a chip field (a listbox floating over what follows). */
export function ChipSuggestionList(props: React.HTMLAttributes<HTMLUListElement>) {
  return <ul role="listbox" className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-md" {...props} />
}

/** One suggestion; the field keeps its focus when it is pressed, then `onPick` adds it. */
export function ChipSuggestionItem({ children, onPick }: { children: ReactNode; onPick: () => void }) {
  return (
    <li role="option" aria-selected={false}>
      <Button variant="ghost" size="row" className="text-sm" onMouseDown={(event) => event.preventDefault()} onClick={onPick}>
        {children}
      </Button>
    </li>
  )
}
