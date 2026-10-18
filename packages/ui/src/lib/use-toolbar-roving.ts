import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { nextToolbarIndex, type ToolbarDirection } from "./toolbar-roving"

const CONTROL_SELECTOR = 'button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"])'

function listControls(root: HTMLElement | null) {
  if (!root) return [] as HTMLElement[]
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(
    (control) => !control.closest('[aria-hidden="true"]') && control.getClientRects().length > 0,
  )
}

/** Roving tabindex + Arrow/Home/End for a role=toolbar root. */
export function useToolbarRoving(deps: unknown[] = []) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [tabStop, setTabStop] = useState(0)

  useLayoutEffect(() => {
    const controls = listControls(rootRef.current)
    if (!controls.length) return
    const index = Math.min(Math.max(tabStop, 0), controls.length - 1)
    controls.forEach((control, controlIndex) => {
      control.tabIndex = controlIndex === index ? 0 : -1
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- caller lists structural deps
  }, [tabStop, ...deps])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const direction: ToolbarDirection | undefined =
      event.key === "ArrowLeft" ? "left" :
      event.key === "ArrowRight" ? "right" :
      event.key === "Home" ? "home" :
      event.key === "End" ? "end" : undefined
    if (!direction) return
    const controls = listControls(rootRef.current)
    if (!controls.length) return
    const current = controls.indexOf(document.activeElement as HTMLElement)
    const next = nextToolbarIndex(
      controls.map(() => true),
      current < 0 ? tabStop : current,
      direction,
    )
    if (next < 0 || next === current) return
    event.preventDefault()
    setTabStop(next)
    controls[next]?.focus()
  }, [tabStop])

  return { rootRef: rootRef as RefObject<HTMLDivElement>, onKeyDown }
}
