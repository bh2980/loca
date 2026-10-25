import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "../lib/utils"
import { useHasDock } from "./right-dock"

export const HEADER_ACTIONS_ID = "page-header-actions"
export const PAGE_HEADING_ID = "loca-page-heading"
export const HEADER_VIEWS_ID = "loca-page-views"

/**
 * Slot portal for main actions in the top app navigation bar.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setSlot(document.getElementById(HEADER_ACTIONS_ID))
  }, [])
  return slot ? createPortal(children, slot) : null
}

/**
 * What the page shows (its view tabs), right after the title: fixed in place, unlike the actions on
 * the right, which come and go with what is selected.
 */
export function HeaderViews({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(HEADER_VIEWS_ID)), [])
  return slot ? createPortal(children, slot) : null
}

/** Breadcrumb or back context placed beside the app header's page title. */
export function PageHeading({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setTarget(document.getElementById(PAGE_HEADING_ID)), [])
  return target ? createPortal(children, target) : null
}

export interface PageProps {
  title?: string
  back?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  /** The content in a centered reading column (the project home). */
  reading?: boolean
  /** The content as a column (its children stack and share the height). */
  column?: boolean
  onTitle?: (title: string) => void
}

/**
 * Standard page frame with optional sticky sub-header toolbar and content area.
 */
export function Page({
  title,
  back,
  meta,
  actions,
  children,
  flush,
  reading,
  column,
  onTitle,
}: PageProps) {
  useEffect(() => {
    if (title && onTitle) {
      onTitle(title)
    }
  }, [title, onTitle])

  const toolbar = back || meta || actions
  const hasDock = useHasDock()

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-page">
      {hasDock && (back || meta) && <PageHeading>
        <div className="flex min-w-0 items-center gap-2">
          {back && <div className="-ml-1 shrink-0">{back}</div>}
          {meta && <div className="min-w-0 flex-1 truncate text-xs text-muted">{meta}</div>}
        </div>
      </PageHeading>}
      {hasDock && actions && <HeaderActions>{actions}</HeaderActions>}
      {toolbar && !hasDock && (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-default bg-page/50 px-3.5 py-1.5 backdrop-blur-xs">
          {back && <div className="-ml-1 shrink-0">{back}</div>}
          <div className="min-w-0 flex-1 truncate text-xs text-muted">
            {meta}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div
        className={cn(
          flush ? "relative min-h-0 flex-1" : "min-h-0 flex-1 px-5 pt-3.5 pb-6",
          reading && "mx-auto w-full max-w-5xl space-y-8 py-8",
          column && "flex flex-col"
        )}
      >
        {children}
      </div>
    </div>
  )
}
