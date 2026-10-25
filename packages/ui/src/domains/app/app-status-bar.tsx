import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const STATUS_BAR_SLOT_ID = 'app-status-bar-slot'

export function AppStatusBar({ children }: { children?: ReactNode }) {
  return <footer aria-label="상태 막대" className="flex h-6 shrink-0 items-center gap-3 border-t border-default bg-chrome px-3 text-2xs text-muted">{children}</footer>
}

export function StatusBarItem({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(STATUS_BAR_SLOT_ID)), [])
  return slot ? createPortal(children, slot) : null
}
