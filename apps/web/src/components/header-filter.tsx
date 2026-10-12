import { useState, type ReactNode } from 'react';
import { Check, ListFilter } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: ReactNode;
  /** Text matched by the search box (defaults to the value). */
  keywords?: string;
  hint?: ReactNode;
}

/**
 * A column header that filters its column, spreadsheet style: click the header, pick a value.
 * The current value stays in the page's URL; an active filter tints the header.
 */
export function HeaderFilter({ label, value, options, onChange, groups }: {
  label: string;
  value?: string;
  options: FilterOption[];
  onChange: (value: string | undefined) => void;
  /** Extra option groups shown under the main one (e.g. tags under statuses). */
  groups?: { heading: string; options: FilterOption[]; value?: string; onChange: (value: string | undefined) => void }[];
}) {
  const [open, setOpen] = useState(false);
  const active = Boolean(value) || Boolean(groups?.some((group) => group.value));
  const pick = (next: string | undefined, apply: (value: string | undefined) => void) => {
    setOpen(false);
    apply(next);
  };
  const item = (option: FilterOption, selected: boolean, apply: (value: string | undefined) => void) => (
    <CommandItem key={option.value} value={`${option.keywords ?? option.value} ${option.value}`} onSelect={() => pick(selected ? undefined : option.value, apply)}>
      <Check className={cn('size-3.5', selected ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{option.label}</span>
      {option.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{option.hint}</span>}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn('-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted', active && 'text-primary')} aria-label={`${label} 필터`}>
          {label}
          <ListFilter className={cn('size-3.5', active ? 'opacity-100' : 'opacity-40')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          {options.length > 8 && <CommandInput placeholder={`${label} 찾기`} />}
          <CommandList>
            <CommandEmpty>맞는 값이 없습니다.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  setOpen(false);
                  onChange(undefined);
                  for (const group of groups ?? []) group.onChange(undefined);
                }}
              >
                <Check className={cn('size-3.5', active ? 'opacity-0' : 'opacity-100')} />
                전체
              </CommandItem>
              {options.map((option) => item(option, value === option.value, onChange))}
            </CommandGroup>
            {groups?.map((group) =>
              group.options.length ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.options.map((option) => item(option, group.value === option.value, group.onChange))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
