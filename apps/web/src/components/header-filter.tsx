import { useState, type ReactNode } from 'react';
import { Check, ListFilter } from 'lucide-react';
import type { AutoMark } from '@tw/shared';
import { Button, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, Popover, PopoverContent, PopoverTrigger } from '@loca/ui';
import { MarkChip, TagChip } from '@/components/status';
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
        <Button variant="ghost" size="inline" className={cn('-mx-1 text-muted-foreground', active && 'text-primary')} aria-label={`${label} 필터`}>
          {label}
          <ListFilter className={active ? 'opacity-100' : 'opacity-40'} />
        </Button>
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

export interface MarkOption {
  key: string;
  label: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
}

export interface MarkGroup {
  heading: string;
  options: MarkOption[];
}

/**
 * The option groups of every mark-and-tag filter (knowledge tables, glossary, script lines):
 * the automatic marks, then the tags, as chips. With `issueHeading`, tags that have a role
 * (problem types) get a group of their own and `tagHeading` keeps the rest.
 */
export function markTagGroups({ marks, picked, onToggle, tags, pickedTags, onToggleTag, projectId, tagHeading = '태그', issueHeading }: {
  marks: readonly AutoMark[];
  picked: readonly AutoMark[] | undefined;
  onToggle: (mark: AutoMark, on: boolean) => void;
  tags: { id: string; name: string; color: string; role?: string | null }[];
  pickedTags: readonly string[] | undefined;
  onToggleTag: (tagId: string, on: boolean) => void;
  projectId?: string;
  tagHeading?: string;
  issueHeading?: string;
}): MarkGroup[] {
  const tagOptions = (list: typeof tags): MarkOption[] => list.map((tag) => ({ key: tag.id, label: <TagChip tag={tag} />, checked: Boolean(pickedTags?.includes(tag.id)), onChange: (on) => onToggleTag(tag.id, on) }));
  // Groups with nothing to pick are left out (a project without problem-type tags shows no such heading).
  const groups: MarkGroup[] = [
    { heading: '자동 표시', options: marks.map((mark) => ({ key: mark, label: <MarkChip mark={mark} projectId={projectId} />, checked: Boolean(picked?.includes(mark)), onChange: (on) => onToggle(mark, on) })) },
    ...(issueHeading ? [{ heading: issueHeading, options: tagOptions(tags.filter((tag) => tag.role)) }] : []),
    { heading: tagHeading, options: tagOptions(issueHeading ? tags.filter((tag) => !tag.role) : tags) },
  ];
  return groups.filter((group) => group.options.length > 0);
}

/**
 * A column header that filters by marks and tags, several at once: each check narrows the rows
 * further (all must hold). The popover stays open while ticking; '전체' clears every pick.
 */
export function MarkFilter({ label, groups, onClear }: { label: string; groups: MarkGroup[]; onClear: () => void }) {
  const active = groups.some((group) => group.options.some((option) => option.checked));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="inline" className={cn('-mx-1 text-muted-foreground', active && 'text-primary')} aria-label={`${label} 필터`}>
          {label}
          <ListFilter className={active ? 'opacity-100' : 'opacity-40'} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={onClear}>
                <Check className={cn('size-3.5', active ? 'opacity-0' : 'opacity-100')} />
                전체
              </CommandItem>
            </CommandGroup>
            {groups.map((group) =>
              group.options.length ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem key={option.key} value={option.key} onSelect={() => option.onChange(!option.checked)}>
                      <Check className={cn('size-3.5', option.checked ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null,
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
