import { useCallback, useState } from "react"

const PREFIX = "tw.section."

const read = (key: string): boolean => {
  if (typeof window === "undefined") return true
  try {
    return window.localStorage.getItem(PREFIX + key) !== "closed"
  } catch {
    return true
  }
}

/**
 * Whether a folding section is open. Every folding section starts open; what a person folds stays folded (localStorage
 * `tw.section.<key>`), for every item of that kind, so `key` names the section's place (`line.history`), not the item.
 */
export function useSectionOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => read(key))
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      try {
        if (next) window.localStorage.removeItem(PREFIX + key)
        else window.localStorage.setItem(PREFIX + key, "closed")
      } catch {
        // Storage off (private mode): the section still folds, it just is not remembered.
      }
    },
    [key],
  )
  return [open, setOpen]
}
