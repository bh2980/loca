import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export function AppStatusBar({ children, className }: { children?: ReactNode; className?: string }) {
  return <footer aria-label="상태 막대" className={cn('flex h-6 shrink-0 items-center gap-3 border-t border-border bg-chrome px-3 text-2xs text-muted-foreground', className)}>{children}</footer>
}
