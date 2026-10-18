import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/utils'

export const STATUS_BAR_SLOT_ID = 'app-status-bar-slot'

export function AppStatusBar({ children, className }: { children?: ReactNode; className?: string }) {
  return <footer aria-label="상태 막대" className={cn('flex h-6 shrink-0 items-center gap-3 border-t border-border bg-chrome px-3 text-2xs text-muted-foreground', className)}>{children}</footer>
}

export function StatusBarItem({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(STATUS_BAR_SLOT_ID)), [])
  return slot ? createPortal(children, slot) : null
}
