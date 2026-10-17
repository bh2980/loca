import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { Button } from "../primitives/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../primitives/input-group"
import { cn } from "../lib/utils"

export interface ToolbarProps {
  children?: ReactNode
  count?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Standard table toolbar: left filters/search, right count + actions.
 */
export function Toolbar({
  children,
  count,
  actions,
  className,
}: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-border/80 bg-surface-2/70 px-3 py-1 backdrop-blur-xs",
        className
      )}
    >
      {children}
      <div className="ml-auto flex items-center gap-1.5">
        {count != null && (
          <span className="text-[11px] font-medium text-muted-foreground/80 tabular-nums">
            {count}
          </span>
        )}
        {actions}
      </div>
    </div>
  )
}

const SEARCH_DEBOUNCE_MS = 250

export interface SearchInputProps {
  value?: string
  onChange: (value: string | undefined) => void
  placeholder: string
  className?: string
  end?: ReactNode
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  end,
}: SearchInputProps) {
  const [text, setText] = useState(value ?? "")
  const sent = useRef(value || undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const composing = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if ((value || undefined) !== sent.current) {
      clearTimeout(timer.current)
      sent.current = value || undefined
      setText(value ?? "")
    }
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  const apply = (next: string) => {
    const trimmed = next.trim() || undefined
    if (trimmed === sent.current) return
    sent.current = trimmed
    onChangeRef.current(trimmed)
  }

  const schedule = (next: string) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(next), SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    clearTimeout(timer.current)
    setText("")
    apply("")
  }

  return (
    <InputGroup className={cn("h-7 w-60 rounded-xs", className)}>
      <InputGroupAddon>
        <Search className="size-3.5 opacity-60" />
      </InputGroupAddon>
      <InputGroupInput
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value)
          if (!composing.current) schedule(event.target.value)
        }}
        onCompositionStart={() => {
          composing.current = true
          clearTimeout(timer.current)
        }}
        onCompositionEnd={(event) => {
          composing.current = false
          schedule(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) {
            event.stopPropagation()
            clear()
          }
        }}
      />
      {(text || end) && (
        <InputGroupAddon align="inline-end" className="text-[11px] tabular-nums">
          {end}
          {text && (
            <InputGroupButton size="icon-xs" aria-label="지우기" onClick={clear}>
              <X className="size-3" />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

export interface PagerProps {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  className?: string
}

export function Pager({ page, total, pageSize, onPage, className }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-1.5 border-t border-border/80 bg-background/50 px-3 py-1.5",
        className
      )}
    >
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {(page * pageSize + 1).toLocaleString()}–{Math.min(total, (page + 1) * pageSize).toLocaleString()} / {total.toLocaleString()}
      </span>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="이전 페이지"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="다음 페이지"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

export interface FilterChip {
  key: string
  label: ReactNode
  name?: string
  clear: () => void
}

export function FilterChips({ chips }: { chips: FilterChip[] }) {
  return chips.map((chip) => (
    <Button
      key={chip.key}
      variant="secondary"
      size="xs"
      onClick={chip.clear}
      aria-label={`${chip.name ?? chip.label} 필터 지우기`}
      className="h-6 gap-1 rounded-xs px-1.5 text-xs font-normal"
    >
      {chip.label} <X className="size-3 opacity-60" />
    </Button>
  ))
}
