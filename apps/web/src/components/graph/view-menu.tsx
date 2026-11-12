import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { q } from '@/lib/queries';
import { useGraphViews } from '@/lib/logs';
import { DeleteViewDialog, useViewActions } from './view-inspector';
import { ChevronDown, MousePointerClick, Pencil, Route as RouteIcon, Trash2 } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icon, Inline, ListRow, MenuLabel, MenuRenameRow, MenuRowAction, MenuRowMeta, MenuSearchField, Stack, Text, ViewSwitch } from '@loca/ui';

export interface MenuView { id: string; label: string; origin: string; nodes: number; route?: unknown }

/** How an open route view is laid out: the graph alone, or the graph with its lines in reading order beside it (the script). */
export function ScriptToggle({ value, onChange }: { value: boolean; onChange: (script: boolean) => void }) {
  return <ViewSwitch label="보기 배치" value={value ? 'script' : 'graph'} onChange={(next) => onChange(next === 'script')} items={[
    { value: 'graph', label: '그래프' }, { value: 'script', label: '그래프 + 대본' },
  ]} />;
}

/** With this many entries a search box is worth its room. */
const SEARCH_FROM = 8;

/**
 * Which part of the dialogue graph is shown: all of it, a section, or a stored view; and where a new
 * view is made (from a route, or from nodes picked on the canvas). A stored view's row has its own
 * rename and delete buttons, shown on hover or focus; it is renamed in place.
 */
export function ViewMenu({ sections, views, chosen, openedLabel, onPick, onRename, onDelete, picked = 0, onNewRoute, onNewNodes }: {
  sections: { name: string; nodes: number }[];
  views: MenuView[];
  /** `view:<id>`, a section name, or nothing for the whole graph. */
  chosen: string | undefined;
  /** The name of the opened view when it is not among `views` yet. */
  openedLabel: string | undefined;
  onPick: (value: string) => void;
  onRename: (view: { id: string; label: string }) => void;
  onDelete: (view: { id: string; label: string }) => void;
  /** How many nodes are picked already: 노드 골라서 만들기 starts from them. */
  picked?: number;
  /** 경로로 만들기: pick a start and an end in the graph. */
  onNewRoute?: () => void;
  /** 노드 골라서 만들기: clicks pick nodes until the view is named. */
  onNewNodes?: () => void;
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
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const commitRename = () => {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (label && label !== views.find((view) => view.id === renaming.id)?.label) onRename({ id: renaming.id, label });
    setRenaming(null);
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
        if (!next) {
          setSearch('');
          setRenaming(null);
        }
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
            {shownViews.map((view) => renaming?.id === view.id ? (
              <MenuRenameRow key={view.id} value={renaming.label} label="보기 이름" maxLength={80} onChange={(label) => setRenaming({ id: view.id, label })} onCommit={commitRename} onCancel={() => setRenaming(null)} />
            ) : (
              <ListRow as="menuitem" key={view.id} selected={chosen === `view:${view.id}`} onSelect={() => pick(`view:${view.id}`)} onPointerMove={keepSearchFocus}>
                {Boolean(view.route) && <Icon icon={RouteIcon} size="xs" tone="muted" aria-label="경로 보기" />}
                <Text minWidth={0} grow truncate>
                  {view.origin === 'ai' && <Text tone="muted">✦ </Text>}
                  {view.label}
                </Text>
                <MenuRowMeta
                  action={
                    <Inline gap="hair">
                      <MenuRowAction aria-label={`보기 ${view.label} 이름 바꾸기`} onClick={() => setRenaming({ id: view.id, label: view.label })}>
                        <Pencil />
                      </MenuRowAction>
                      <MenuRowAction
                        danger
                        aria-label={`보기 ${view.label} 삭제`}
                        onClick={() => {
                          setOpen(false);
                          onDelete({ id: view.id, label: view.label });
                        }}
                      >
                        <Trash2 />
                      </MenuRowAction>
                    </Inline>
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
        {(onNewRoute || onNewNodes) && !query && (
          <>
            <DropdownMenuSeparator />
            <MenuLabel>새 보기</MenuLabel>
            {onNewRoute && (
              <DropdownMenuItem onSelect={() => { setOpen(false); onNewRoute(); }}>
                <RouteIcon />
                <Stack minWidth={0}>
                  <span>경로로 만들기</span>
                  <Text variant="caption" tone="muted">시작과 끝을 골라 그 길을 엽니다</Text>
                </Stack>
              </DropdownMenuItem>
            )}
            {onNewNodes && (
              <DropdownMenuItem onSelect={() => { setOpen(false); onNewNodes(); }}>
                <MousePointerClick />
                <Stack minWidth={0}>
                  <span>{picked > 0 ? `노드 골라서 만들기 (${picked.toLocaleString()}개 고름)` : '노드 골라서 만들기'}</span>
                  <Text variant="caption" tone="muted">누른 노드만 남깁니다</Text>
                </Stack>
              </DropdownMenuItem>
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

/**
 * The 보기 menu with the lists it shows (sections, stored views) and its delete dialog, for a screen
 * that does not hold them itself: an open route view laid out with its script.
 */
export function GraphViewMenu({ projectId, direction, chosen, openedLabel, onPick, onDeleted, onNewRoute }: {
  projectId: string;
  direction: 'vertical' | 'horizontal';
  chosen: string | undefined;
  openedLabel: string | undefined;
  onPick: (value: string) => void;
  onDeleted: (id: string) => void;
  onNewRoute?: () => void;
}) {
  const sections = useQuery(q.graphSections(projectId, direction)).data ?? [];
  const views = useGraphViews(projectId).data ?? [];
  const [deleting, setDeleting] = useState<{ id: string; label: string } | null>(null);
  const actions = useViewActions(projectId);
  return (
    <>
      <ViewMenu sections={sections} views={views} chosen={chosen} openedLabel={openedLabel} onPick={onPick} onRename={(view) => actions.change.mutate(view)} onDelete={setDeleting} onNewRoute={onNewRoute} />
      <DeleteViewDialog projectId={projectId} view={deleting} onClose={() => setDeleting(null)} onDeleted={(id) => { setDeleting(null); onDeleted(id); }} />
    </>
  );
}
