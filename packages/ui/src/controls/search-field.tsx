import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Search, X } from "lucide-react"
import { cn } from "../lib/utils"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group"
import { Input } from "./input"

const SEARCH_DEBOUNCE_MS = 250

const SIZE = { default: "w-menu-lg", sm: "w-menu", fill: "w-full" } as const

export interface SearchFieldProps {
  value?: string
  onChange: (value: string | undefined) => void
  placeholder: string
  /** Width: `default` 15rem, `sm` 14rem, `fill` the width of its parent. */
  size?: keyof typeof SIZE
  /** The wider, card-colored box laid over a canvas (fills its wrapper). */
  onCanvas?: boolean
  /** Shown at the right end, before the clear button (a match count). */
  end?: ReactNode
}

/** A search box that sends its text 250ms after typing stops (not while composing), with a clear button and Esc to clear. */
export function SearchField({ value, onChange, placeholder, size = "default", onCanvas, end }: SearchFieldProps) {
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
    <InputGroup className={cn("h-7 rounded-xs", SIZE[size], onCanvas && "w-full bg-surface border-default shadow-2xs text-xs rounded-md")}>
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
        <InputGroupAddon align="inline-end" className="text-2xs tabular-nums">
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

/** A search field at the top of a menu: the text goes to `onChange` as typed (no delay), the magnifier sits inside. */
export function MenuSearchField(props: Omit<ComponentProps<typeof Input>, "className">) {
  return (
    <div className="relative px-1 pb-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-[60%] text-muted" />
      <Input className="pl-8" {...props} />
    </div>
  )
}
