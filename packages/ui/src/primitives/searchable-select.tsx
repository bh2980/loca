import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "./button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "../lib/utils"

export interface SearchableSelectOption {
  value: string
  label: string
  searchText?: string
}

/** Searchable picker that keeps only the first fifty matches mounted for large collections. */
export function SearchableSelect({ value, onValueChange, options, placeholder = "선택", searchPlaceholder = "검색", emptyText = "검색 결과가 없습니다", ariaLabel, disabled, onSearch, selectedLabel }: {
  value?: string
  onValueChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  ariaLabel: string
  disabled?: boolean
  /** Searched elsewhere (e.g. on the server): the options are already the matches for the query it is given. */
  onSearch?: (query: string) => void
  /** The chosen value's label when it is not among the options (searched lists hold only matches). */
  selectedLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLocaleLowerCase()
  const matches = useMemo(() => (onSearch ? options : options.filter((option) => !normalized || `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase().includes(normalized))), [options, normalized, onSearch])
  const visible = matches.slice(0, 50)
  const selected = options.find((option) => option.value === value) ?? (value && selectedLabel ? { value, label: selectedLabel } : undefined)

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label={ariaLabel} aria-expanded={open} disabled={disabled} className="w-full min-w-0 justify-between gap-2">
          <span className={cn("min-w-0 truncate text-left", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popper-available-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput autoFocus aria-label={`${ariaLabel} 검색`} value={query} onValueChange={(next) => { setQuery(next); onSearch?.(next) }} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {visible.map((option) => (
              <CommandItem key={option.value} value={option.value} onSelect={() => { onValueChange(option.value); setOpen(false); setQuery("") }}>
                <Check className={cn("size-3.5 shrink-0", value === option.value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </CommandItem>
            ))}
            {matches.length > visible.length && <p className="px-3 py-2 text-xs text-muted-foreground">검색어를 더 입력해 결과를 좁혀 주세요.</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
