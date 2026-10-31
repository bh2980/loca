import type { ReactNode } from "react"

/** Quiet column labels aligned to TranslationRow, or a full-width bulk selection toolbar; a hairline under it divides it from the rows. */
export function TranslationColumnHeader({ checkbox, source, translation, selection }: {
  checkbox?: ReactNode
  source?: ReactNode
  translation?: ReactNode
  selection?: ReactNode
}) {
  return (
    <div className="grid min-h-10 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 border-b border-subtle bg-page px-3 py-2 text-xs text-muted">
      <span className="flex justify-center">{checkbox}</span>
      {selection ? (
        <div className="col-span-2 min-w-0">{selection}</div>
      ) : (
        <>
          <span className="min-w-0 truncate">{source}</span>
          <span className="min-w-0 truncate">{translation}</span>
        </>
      )}
    </div>
  )
}
