import { useState, type ReactNode } from "react"
import { Check, ListFilter } from "lucide-react"
import { Button } from "../primitives/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../primitives/command"
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover"
import { cn } from "../lib/utils"

export interface FilterOption {
  value: string
  label: ReactNode
  keywords?: string
  hint?: ReactNode
}

export interface HeaderFilterProps {
  label: string
  value?: string
  options: FilterOption[]
  onChange: (value: string | undefined) => void
  groups?: {
    heading: string
    options: FilterOption[]
    value?: string
    onChange: (value: string | undefined) => void
  }[]
}

export function HeaderFilter({
  label,
  value,
  options,
  onChange,
  groups,
}: HeaderFilterProps) {
  const [open, setOpen] = useState(false)
  const active = Boolean(value) || Boolean(groups?.some((group) => group.value))

  const pick = (next: string | undefined, apply: (value: string | undefined) => void) => {
    setOpen(false)
    apply(next)
  }

  const item = (
    option: FilterOption,
    selected: boolean,
    apply: (value: string | undefined) => void
  ) => (
    <CommandItem
      key={option.value}
      value={`${option.keywords ?? option.value} ${option.value}`}
      onSelect={() => pick(selected ? undefined : option.value, apply)}
    >
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{option.label}</span>
      {option.hint && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {option.hint}
        </span>
      )}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="inline"
          className={cn("-mx-1 text-xs text-muted-foreground hover:text-foreground", active && "text-primary font-medium")}
          aria-label={`${label} 필터`}
        >
          {label}
          <ListFilter className={cn("size-3", active ? "opacity-100 text-primary" : "opacity-40")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0 shadow-md">
        <Command>
          {options.length > 8 && <CommandInput placeholder={`${label} 찾기`} />}
          <CommandList>
            <CommandEmpty>맞는 값이 없습니다.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  setOpen(false)
                  onChange(undefined)
                  for (const group of groups ?? []) group.onChange(undefined)
                }}
              >
                <Check className={cn("size-3.5", active ? "opacity-0" : "opacity-100")} />
                전체
              </CommandItem>
              {options.map((option) => item(option, value === option.value, onChange))}
            </CommandGroup>
            {groups?.map((group) =>
              group.options.length ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.options.map((option) =>
                    item(option, group.value === option.value, group.onChange)
                  )}
                </CommandGroup>
              ) : null
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export interface MarkOption {
  key: string
  label: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
}

export interface MarkGroup {
  heading: string
  options: MarkOption[]
}

export function MarkFilter({
  label,
  groups,
  onClear,
}: {
  label: string
  groups: MarkGroup[]
  onClear: () => void
}) {
  const active = groups.some((group) => group.options.some((option) => option.checked))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="inline"
          className={cn("-mx-1 text-xs text-muted-foreground hover:text-foreground", active && "text-primary font-medium")}
          aria-label={`${label} 필터`}
        >
          {label}
          <ListFilter className={cn("size-3", active ? "opacity-100 text-primary" : "opacity-40")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0 shadow-md">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={onClear}>
                <Check className={cn("size-3.5", active ? "opacity-0" : "opacity-100")} />
                전체
              </CommandItem>
            </CommandGroup>
            {groups.map((group) =>
              group.options.length ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.key}
                      value={option.key}
                      onSelect={() => option.onChange(!option.checked)}
                    >
                      <Check className={cn("size-3.5", option.checked ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
