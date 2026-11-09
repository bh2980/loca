import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Box, Button, Checkbox, Icon, Inline, ScopeRow, SearchField, Text } from '@loca/ui';
import { SCRIPT_VIEW } from '@/lib/labels';

const KIND_ORDER = ['scene', 'ui', 'document'] as const;

/**
 * Every group of the project as one table: 전체, then each kind (대사 · UI · 문서) with its own
 * checkbox and fold, then its groups. Kinds start folded; a search opens them.
 */
/** One section of the picker: a fold with its items (scenes of a kind, or terms of a status). */
export interface PickSection {
  key: string;
  /** None: the items sit right under 전체 (terms have no grouping). */
  label?: string;
  items: { id: string; title: string; search: string; total: number; detail: string }[];
}

/** The items to pick for a run or an export: 전체 → sections → items, with a search; the same for lines (scenes) and terms. */
export function ScopePicker({ sections, unit, picked, setPicked, filter, setFilter }: { sections: PickSection[]; unit: string; picked: Set<string>; setPicked: SetPicked; filter: string; setFilter: (value: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const needle = filter.trim().toLowerCase();
  const all = sections.flatMap((section) => section.items);
  const shownOf = (section: PickSection) => (needle ? section.items.filter((item) => item.search.toLowerCase().includes(needle)) : section.items);
  const total = (list: PickSection['items']) => list.reduce((sum, item) => sum + item.total, 0);
  const state = (list: PickSection['items']) => {
    const count = list.filter((item) => picked.has(item.id)).length;
    return count === list.length ? true : count > 0 ? ('indeterminate' as const) : false;
  };
  const setMany = (list: PickSection['items'], on: boolean) =>
    setPicked((previous) => {
      const next = new Set(previous);
      for (const item of list) on ? next.add(item.id) : next.delete(item.id);
      return next;
    });
  const itemRow = (item: PickSection['items'][number]) => (
    <li key={item.id}>
      <ScopeRow>
        <Checkbox checked={picked.has(item.id)} onCheckedChange={(checked) => toggled(setPicked, item.id, checked === true)} />
        <Text minWidth={0} grow truncate>{item.title}</Text>
        <Text shrink={false} variant="caption" tone="muted" tabular>{item.detail}</Text>
      </ScopeRow>
    </li>
  );
  return (
    <Box minWidth={0} overflow="hidden" radius="md" border="all">
      <Box border="bottom" padding="tight">
        <SearchField size="fill" value={filter} onChange={(value) => setFilter(value ?? '')} placeholder="찾기" end={`${total(all.filter((item) => picked.has(item.id))).toLocaleString()}${unit}`} />
      </Box>
      <Box maxHeight="scroll" overflow="auto" padding="tight">
        <ScopeRow kind="all">
          <Checkbox checked={state(all)} onCheckedChange={(checked) => setMany(all, checked === true)} />
          <Text minWidth={0} grow>전체</Text>
          <Text shrink={false} variant="caption" weight="normal" tone="muted" tabular>{total(all).toLocaleString()}{unit}</Text>
        </ScopeRow>
        {sections.filter((section) => section.items.length).map((section) => {
          if (!section.label)
            return (
              <Box as="ul" key={section.key} marginLeft="comfortable">
                {shownOf(section).map(itemRow)}
              </Box>
            );
          const expanded = Boolean(needle) || open.has(section.key);
          return (
            <div key={section.key}>
              {/* Each level steps in by 16px: 전체 → section → its items. The fold arrow sits in that step. */}
              <Inline minWidth={0} paddingLeft="condensed">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  width="icon"
                  aria-label={`${section.label} ${expanded ? '접기' : '펼치기'}`}
                  aria-expanded={expanded}
                  onClick={() => toggled(setOpen as SetPicked, section.key, !open.has(section.key))}
                >
                  <Icon icon={ChevronRight} turn={expanded} />
                </Button>
                <ScopeRow kind="section">
                  <Checkbox checked={state(section.items)} onCheckedChange={(checked) => setMany(section.items, checked === true)} />
                  <Text minWidth={0} grow truncate>{section.label}</Text>
                  <Text shrink={false} variant="caption" tone="muted" tabular>{section.items.length.toLocaleString()}개{unit === '줄' && ` · ${total(section.items).toLocaleString()}줄`}</Text>
                </ScopeRow>
              </Inline>
              {expanded && (
                <Box as="ul" marginLeft="wide">
                  {shownOf(section).map(itemRow)}
                </Box>
              )}
            </div>
          );
        })}
      </Box>
    </Box>
  );
}

export type SetPicked = (update: (previous: Set<string>) => Set<string>) => void;

/** Ticks one id in or out of a picked set. */
export const toggled = (setPicked: SetPicked, id: string, checked: boolean) =>
  setPicked((previous) => {
    const next = new Set(previous);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });

/** The project's groups as the picker lists them: 대사 · UI · 문서, each with its groups. */
export function lineScopeSections(groups: readonly { id: string; kind: (typeof KIND_ORDER)[number]; title: string; key: string; total: number }[]): PickSection[] {
  return KIND_ORDER.map((kind) => ({
    key: kind,
    label: SCRIPT_VIEW[kind],
    items: groups.filter((group) => group.kind === kind).map((group) => ({ id: group.id, title: group.title, search: `${group.title} ${group.key}`, total: group.total, detail: `${group.total}줄` })),
  }));
}
