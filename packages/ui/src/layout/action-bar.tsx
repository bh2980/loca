import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "../primitives/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../primitives/dropdown-menu"
import { cn } from "../lib/utils"
import { useToolbarRoving } from "../lib/use-toolbar-roving"

export interface ActionBarItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  priority?: number
  overflow?: "auto" | "always" | "never"
}
export interface ActionBarProps {
  items: ActionBarItem[]
  "aria-label": string
  className?: string
}
const MENU_WIDTH = 28

export function ActionBar({ items, "aria-label": ariaLabel, className }: ActionBarProps) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const { visible, overflowed } = useMemo(() => {
    const shown = items.filter((item) => item.overflow !== "always" && !item.destructive)
    const menu = items.filter((item) => item.overflow === "always" || item.destructive)
    const gap = 4
    const width = (item: ActionBarItem) => widths[item.id] ?? 0
    const total = () => shown.reduce((sum, item) => sum + width(item), 0) + Math.max(0, shown.length - 1) * gap
    const candidates = [...shown]
      .filter((item) => item.overflow !== "never")
      .sort(
        (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || items.indexOf(b) - items.indexOf(a),
      )
    while (shown.length && total() + (menu.length ? MENU_WIDTH + gap : 0) > available) {
      const next = candidates.shift()
      if (!next) break
      shown.splice(shown.indexOf(next), 1)
      menu.push(next)
    }
    if (menu.length === 1 && menu[0].overflow !== "always" && !menu[0].destructive) {
      const single = menu.pop()!
      shown.push(single)
    }
    return {
      visible: items.filter((item) => shown.includes(item)),
      overflowed: items.filter((item) => menu.includes(item)),
    }
  }, [available, items, widths])
  const { rootRef, onKeyDown } = useToolbarRoving([visible, overflowed])

  useLayoutEffect(() => {
    const root = rootRef.current
    const measure = measureRef.current
    if (!root || !measure) return
    const update = () => {
      const container = root.closest("header, [role='region'], .flex-1") || root.parentElement
      let maxAvailable = root.getBoundingClientRect().width
      if (container) {
        let current: HTMLElement | null = root
        let intermediateSiblingsWidth = 0
        while (current && current !== container) {
          const parent: HTMLElement | null = current.parentElement
          if (!parent) break
          const siblings = Array.from(parent.children).filter((el) => el !== current) as HTMLElement[]
          intermediateSiblingsWidth += siblings.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
          current = parent
        }
        const containerWidth = container.getBoundingClientRect().width
        maxAvailable = Math.max(root.getBoundingClientRect().width, containerWidth - intermediateSiblingsWidth - 24)
      }
      setAvailable(maxAvailable)
      const next: Record<string, number> = {}
      measure.querySelectorAll<HTMLElement>("[data-action-id]").forEach((el) => {
        next[el.dataset.actionId!] = el.getBoundingClientRect().width
      })
      setWidths(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    observer.observe(measure)
    if (root.parentElement) observer.observe(root.parentElement)
    const container = root.closest("header, [role='region'], .flex-1")
    if (container) observer.observe(container)
    return () => observer.disconnect()
  }, [items, rootRef])

  const iconMode = visible.length > 0 && visible.every((item) => item.icon != null)
  const regular = overflowed.filter((item) => !item.destructive)
  const destructive = overflowed.filter((item) => item.destructive)
  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("relative flex min-w-0 flex-nowrap items-center gap-1", className)}
    >
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute -z-10 flex w-max items-center gap-1 opacity-0"
      >
        {items
          .filter((item) => item.overflow !== "always" && !item.destructive)
          .map((item) => (
            <Button key={item.id} data-action-id={item.id} tabIndex={-1} variant="ghost" size="sm">
              {iconMode && item.icon}
              {item.label}
            </Button>
          ))}
      </div>
      {visible.map((item) => (
        <Button
          key={item.id}
          variant="ghost"
          size="sm"
          disabled={item.disabled}
          onClick={item.onSelect}
        >
          {iconMode && item.icon}
          {item.label}
        </Button>
      ))}
      {!!overflowed.length && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="더보기" title="더보기">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" aria-label="더보기">
            {regular.map((item) => (
              <DropdownMenuItem key={item.id} disabled={item.disabled} onSelect={item.onSelect}>
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
            {!!destructive.length && (
              <>
                {!!regular.length && <DropdownMenuSeparator />}
                {destructive.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    variant="destructive"
                    disabled={item.disabled}
                    onSelect={item.onSelect}
                  >
                    {item.icon}
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
