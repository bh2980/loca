import { useRef, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, Icon, ListRow, MenuLabel, MenuRowAction, MenuRowMeta, MenuSearchField, Text } from '@loca/ui';

export interface MenuView { id: string; label: string; origin: string; nodes: number }

/** With this many entries a search box is worth its room. */
const SEARCH_FROM = 8;

/**
 * Which part of the dialogue graph is shown: all of it, a section, or a stored view. A stored
 * view's row has its own delete button, shown on hover or focus.
 */
export function ViewMenu({ sections, views, chosen, openedLabel, onPick, onDelete }: {
  sections: { name: string; nodes: number }[];
  views: MenuView[];
  /** `view:<id>`, a section name, or nothing for the whole graph. */
  chosen: string | undefined;
  /** The name of the opened view when it is not among `views` yet. */
  openedLabel: string | undefined;
  onPick: (value: string) => void;
  onDelete: (view: { id: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchBox = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const matches = (label: string) => !query || label.toLocaleLowerCase().includes(query);
  const shownSections = sections.filter((section) => matches(section.name));
  const shownViews = views.filter((view) => matches(view.label));
  const current = chosen === undefined ? '전체' : (sections.find((section) => section.name === chosen)?.name ?? views.find((view) => `view:${view.id}` === chosen)?.label ?? openedLabel ?? chosen);
  const opened = chosen?.startsWith('view:') && !views.some((view) => `view:${view.id}` === chosen) && openedLabel ? { value: chosen, label: openedLabel } : undefined;
  const pick = (value: string) => {
    setOpen(false);
    onPick(value);
  };
  // While the search box has focus the menu must not move focus to the row under the pointer.
  const keepSearchFocus = (event: { preventDefault: () => void }) => {
    if (document.activeElement === searchBox.current) event.preventDefault();
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="보기" width="menu" justifyContent="between" minWidth={0}>
          <Text tone="muted" shrink={false}>보기</Text>
          <Text minWidth={0} grow truncate align="start">{current}</Text>
          <Icon icon={ChevronDown} tone="muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="menu-lg" maxHeight="dialog">
        {sections.length + views.length >= SEARCH_FROM && (
          <MenuSearchField
            ref={searchBox}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              // Typing must not trigger the menu's type-ahead; arrows and Esc stay with the menu.
              if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) event.stopPropagation();
            }}
            placeholder="보기 찾기"
            aria-label="보기 검색"
          />
        )}
        {matches('전체') && (
          <ListRow as="menuitem" selected={chosen === undefined} onSelect={() => pick('all')} onPointerMove={keepSearchFocus}>
            <Text>전체</Text>
          </ListRow>
        )}
        {shownSections.map((section) => (
          <ListRow as="menuitem" key={section.name} selected={chosen === section.name} onSelect={() => pick(section.name)} onPointerMove={keepSearchFocus}>
            <Text minWidth={0} grow truncate>{section.name}</Text>
            <Text shrink={false} variant="caption" tone="muted" tabular>{section.nodes.toLocaleString()}</Text>
          </ListRow>
        ))}
        {(shownViews.length > 0 || opened) && (
          <>
            <DropdownMenuSeparator />
            <MenuLabel>저장된 보기</MenuLabel>
            {shownViews.map((view) => (
              <ListRow as="menuitem" key={view.id} selected={chosen === `view:${view.id}`} onSelect={() => pick(`view:${view.id}`)} onPointerMove={keepSearchFocus}>
                <Text minWidth={0} grow truncate>
                  {view.origin === 'ai' && <Text tone="muted">✦ </Text>}
                  {view.label}
                </Text>
                <MenuRowMeta
                  action={
                    <MenuRowAction
                      danger
                      aria-label={`보기 ${view.label} 삭제`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpen(false);
                        onDelete({ id: view.id, label: view.label });
                      }}
                      // The menu selects its row on pointer up too; the delete button is not that row.
                    >
                      <Trash2 />
                    </MenuRowAction>
                  }
                >
                  {view.nodes.toLocaleString()}개
                </MenuRowMeta>
              </ListRow>
            ))}
            {opened && (
              <ListRow as="menuitem" selected onSelect={() => pick(opened.value)}>
                <Text minWidth={0} grow truncate>{opened.label}</Text>
              </ListRow>
            )}
          </>
        )}
        {query && !shownSections.length && !shownViews.length && !matches('전체') && (
          <Text as="p" paddingX="condensed" paddingY="condensed" variant="body" tone="muted">찾는 보기가 없습니다.</Text>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
