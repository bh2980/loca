import { useState, type ReactNode } from 'react';
import { EyeOff, ListFilter } from 'lucide-react';
import type { AutoMark } from '@tw/shared';
import { Box, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, FilterCheck, FilterHeaderButton, Icon, Popover, PopoverTrigger, TagChip, Text, PopoverContent, SegmentedControl } from '@loca/ui';
import { MarkChip } from '@/components/status';

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
      <FilterCheck on={selected} />
      <Text truncate>{option.label}</Text>
      {option.hint && <Text variant="caption" tone="muted" tabular marginLeft="auto" shrink={false}>{option.hint}</Text>}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterHeaderButton label={label} active={active} aria-label={`${label} 필터`} />
      </PopoverTrigger>
      <PopoverContent align="start" width="menu-lg" padding="none">
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
                <FilterCheck on={!active} />
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

/**
 * How a pick filters: 'show' keeps only the lines that have it, 'hide' leaves them out. A filter menu
 * picks in one mode at a time (FilterModeSwitch at its top) and a picked row shows which (PickIcon).
 */
export type FilterPick = 'show' | 'hide';

export function FilterModeSwitch({ mode, onMode }: { mode: FilterPick; onMode: (mode: FilterPick) => void }) {
  return (
    <SegmentedControl
      fill
      ariaLabel="필터 방식"
      value={mode}
      onChange={(value) => onMode(value as FilterPick)}
      items={[
        { value: 'show', label: <><ListFilter aria-hidden="true" />이것만 보기</> },
        { value: 'hide', label: <><EyeOff aria-hidden="true" />숨기기</> },
      ]}
    />
  );
}

/** A row's pick: ✓ shown only, an eye shut for hidden, nothing when not picked. */
export function PickIcon({ state }: { state: FilterPick | undefined }) {
  return state === 'hide' ? <Icon icon={EyeOff} size="sm" tone="muted" aria-label="숨김" /> : <FilterCheck on={Boolean(state)} aria-label={state ? '이것만 보기' : undefined} />;
}

/**
 * One value picked in a mode: the value moves to that mode's list (out of the other), or comes out
 * of both when it already was there. Empty lists become undefined, as the URL keeps them.
 */
export function togglePick<T>(show: readonly T[] | undefined, hide: readonly T[] | undefined, value: T, mode: FilterPick) {
  const was: FilterPick | undefined = show?.includes(value) ? 'show' : hide?.includes(value) ? 'hide' : undefined;
  const nextShow = (show ?? []).filter((item) => item !== value);
  const nextHide = (hide ?? []).filter((item) => item !== value);
  if (was !== mode) (mode === 'show' ? nextShow : nextHide).push(value);
  return { show: nextShow.length ? nextShow : undefined, hide: nextHide.length ? nextHide : undefined };
}

export const pickOf = <T,>(show: readonly T[] | undefined, hide: readonly T[] | undefined, value: T): FilterPick | undefined => (show?.includes(value) ? 'show' : hide?.includes(value) ? 'hide' : undefined);

export interface MarkOption {
  key: string;
  label: ReactNode;
  state: FilterPick | undefined;
  onPick: (mode: FilterPick) => void;
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
export function markTagGroups({ marks, picked, hidden, onMark, tags, pickedTags, hiddenTags, onTag, projectId, tagHeading = '태그', issueHeading }: {
  marks: readonly AutoMark[];
  picked: readonly AutoMark[] | undefined;
  hidden?: readonly AutoMark[] | undefined;
  /** A mark picked in a mode (togglePick decides what that does). */
  onMark: (mark: AutoMark, mode: FilterPick) => void;
  tags: { id: string; name: string; color: string; role?: string | null }[];
  pickedTags: readonly string[] | undefined;
  hiddenTags?: readonly string[] | undefined;
  onTag: (tagId: string, mode: FilterPick) => void;
  projectId?: string;
  tagHeading?: string;
  issueHeading?: string;
}): MarkGroup[] {
  const tagOptions = (list: typeof tags): MarkOption[] => list.map((tag) => ({ key: tag.id, label: <TagChip tag={tag} />, state: pickOf(pickedTags, hiddenTags, tag.id), onPick: (mode) => onTag(tag.id, mode) }));
  // Groups with nothing to pick are left out (a project without problem-type tags shows no such heading).
  const groups: MarkGroup[] = [
    { heading: "자동 태그", options: marks.map((mark) => ({ key: mark, label: <MarkChip mark={mark} projectId={projectId} />, state: pickOf(picked, hidden, mark), onPick: (mode) => onMark(mark, mode) })) },
    ...(issueHeading ? [{ heading: issueHeading, options: tagOptions(tags.filter((tag) => tag.role)) }] : []),
    { heading: tagHeading, options: tagOptions(issueHeading ? tags.filter((tag) => !tag.role) : tags) },
  ];
  return groups.filter((group) => group.options.length > 0);
}

/**
 * A column header that filters by marks and tags, several at once: shown picks narrow the rows (all
 * must hold), hidden ones leave rows out (any one does). The popover stays open while picking; '전체'
 * clears every pick.
 */
export function MarkFilter({ label, groups, onClear }: { label: string; groups: MarkGroup[]; onClear: () => void }) {
  const active = groups.some((group) => group.options.some((option) => option.state));
  const [mode, setMode] = useState<FilterPick>('show');
  return (
    <Popover onOpenChange={(open) => open && setMode('show')}>
      <PopoverTrigger asChild>
        <FilterHeaderButton label={label} active={active} aria-label={`${label} 필터`} />
      </PopoverTrigger>
      <PopoverContent align="start" width="menu-lg" padding="none">
        <Box padding="condensed" paddingBottom="none">
          <FilterModeSwitch mode={mode} onMode={setMode} />
        </Box>
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={onClear}>
                <FilterCheck on={!active} />
                전체
              </CommandItem>
            </CommandGroup>
            {groups.map((group) =>
              group.options.length ? (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem key={option.key} value={option.key} onSelect={() => option.onPick(mode)}>
                      <PickIcon state={option.state} />
                      <Text truncate>{option.label}</Text>
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
