import type * as React from "react"
import type { ReactNode } from "react"
import { Box } from "../../primitives/box"

/** A card with a checkbox and what it stands for; the whole card toggles it (a preset of format rules). */
export function RulesPresetCard(props: Omit<React.LabelHTMLAttributes<HTMLLabelElement>, "className">) {
  return <label className="flex cursor-pointer flex-col gap-1.5 rounded-md border border-default bg-surface p-3 text-sm transition-colors hover:bg-sunken/50" {...props} />
}

/**
 * The monospaced example line of a preset card, under its checkbox. With `found` examples it says `lead` (in the normal font) and then
 * lists them; otherwise it shows `fallback`.
 */
export function RulesPresetExample({ lead, found, fallback }: { lead: ReactNode; found: string[]; fallback: ReactNode }) {
  return (
    <Box paddingLeft="spacious" mono variant="caption" tone="muted" truncate>
      {found.length > 0 ? (
        <>
          <span className="font-sans text-subtle">{lead} </span>
          {found.join("   ")}
        </>
      ) : (
        fallback
      )}
    </Box>
  )
}
