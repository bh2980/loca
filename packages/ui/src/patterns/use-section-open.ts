import { useCallback, useState } from "react"

import { readStored, writeStored } from "../lib/storage"

const stored = (key: string) => `section.${key}`

/**
 * Whether a folding section is open. Every folding section starts open; what a person folds stays folded (kept as
 * `section.<key>`, lib/storage.ts), for every item of that kind, so `key` names the section's place (`line.history`), not the item.
 */
export function useSectionOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => readStored("local", stored(key)) !== "closed")
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      writeStored("local", stored(key), next ? null : "closed")
    },
    [key],
  )
  return [open, setOpen]
}
