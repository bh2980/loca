import { useId, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./button"

export interface TagInputProps {
  id?: string
  value: string[]
  onChange: (value: string[]) => void
  /** Values offered as you type (those already in the field are left out; at most six show). */
  suggestions?: string[]
  placeholder?: string
}

/**
 * Several short values in one field: typing a comma or Enter turns the text into a tag, Backspace on an empty field removes the
 * last one, leaving the field keeps what was typed, and `suggestions` are offered while it has focus.
 */
export function TagInput({ id, value, onChange, suggestions = [], placeholder }: TagInputProps) {
  const [text, setText] = useState("")
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const add = (raw: string) => {
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean)
    const next = [...value]
    for (const part of parts) if (!next.includes(part)) next.push(part)
    if (next.length !== value.length) onChange(next)
    setText("")
  }
  const needle = text.trim().toLowerCase()
  const offered = [...new Set(suggestions)].filter((option) => !value.includes(option) && (!needle || option.toLowerCase().includes(needle))).slice(0, 6)

  return (
    <div className="relative">
      <div
        className={cn("flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-page px-2 py-1 text-sm shadow-xs", focused && "border-focus ring-[3px] ring-focus/50")}
        onClick={() => input.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} data-slot="chip" className="inline-flex items-center rounded bg-sunken py-0.5 text-xs gap-0.5 pr-0.5 pl-2">
            {tag}
            <Button variant="ghost" size="icon-xs" aria-label={`${tag} 빼기`} onClick={(event) => (event.stopPropagation(), onChange(value.filter((item) => item !== tag)))}>
              <X />
            </Button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted"
          value={text}
          placeholder={value.length ? undefined : placeholder}
          aria-autocomplete="list"
          aria-controls={listId}
          onFocus={() => setFocused(true)}
          // Leaving the field keeps what was typed as a tag; the delay lets a suggestion click land first.
          onBlur={() => setTimeout(() => (setFocused(false), text.trim() && add(text)), 120)}
          onChange={(event) => (event.target.value.includes(",") ? add(event.target.value) : setText(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim()) {
              event.preventDefault()
              add(text)
            } else if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1))
          }}
        />
      </div>
      {focused && offered.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full rounded-md border bg-overlay p-1 shadow-md">
          {offered.map((option) => (
            <li key={option} role="option" aria-selected={false}>
              <Button variant="ghost" size="row" className="text-sm" onMouseDown={(event) => event.preventDefault()} onClick={() => add(option)}>
                {option}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
