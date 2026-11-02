import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LineMark } from '@tw/shared';
import { Link } from '@tanstack/react-router';
import { AppWindow, Check, FileText, Inbox, MessageSquareText, Plus, type LucideIcon } from 'lucide-react';
import { Box, Button, ExpandableRow, ContextMenu, ContextMenuTrigger, Icon, Inline, ListRow, Stack, Count, SearchField, Meter, Text, Tooltip, TooltipContent, TooltipTrigger, type StatusLike, ContextMenuContent } from '@loca/ui';
import { GROUP_KIND, SCRIPT_VIEW, SOURCE_GROUP_LABEL } from '@/lib/labels';

export interface GroupRow {
  id: string;
  kind: keyof typeof GROUP_KIND;
  title: string;
  key: string;
  section: string | null;
  sort: number;
  total: number;
  statuses: Record<string, number>;
  unknownListeners: number;
}

/** Sections start closed by default; explicit unfolds are a per-tab convenience, like the graph viewport. */
const storageKey = (projectId: string) => `tw.script.expanded.${projectId}`;
const readExpanded = (projectId: string): string[] => {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? '[]');
  } catch {
    return [];
  }
};

/** Consecutive groups of the same section, in script order. */
function sectionsOf(groups: GroupRow[]) {
  const sections: { key: string; name: string | null; groups: GroupRow[] }[] = [];
  for (const group of [...groups].sort((a, b) => a.sort - b.sort)) {
    const last = sections.at(-1);
    if (last && last.name === group.section) last.groups.push(group);
    else sections.push({ key: `${sections.length}:${group.section ?? ''}`, name: group.section, groups: [group] });
  }
  return sections;
}

export type ScriptScope = { group?: string; review?: true; kind?: GroupRow['kind']; section?: string };

const VIEW_ICON = { scene: MessageSquareText, ui: AppWindow, document: FileText };

/**
 * Source kinds and chapter navigation down the left of the translation screen, with review pinned below.
 * Each scene shows only how many of its lines are done (in a final status), or a check when all are.
 */
export function GroupList({ projectId, groups, finalIds, initialIds, scope, reviewCount, gq, onFilter, marks, views, statuses, onCreate, menu }: {
  projectId: string;
  groups: GroupRow[] | undefined;
  /** Statuses that count as done. */
  finalIds: Set<string>;
  /** 미번역 and the like: a line past these has been started (translated at least once). */
  initialIds: Set<string>;
  scope: ScriptScope;
  reviewCount: number;
  gq?: string;
  onFilter: (gq: string | undefined) => void;
  /** While a filter is walked (찾아가기): how many of its lines each scene holds; scenes keep the filter. */
  marks?: Map<string, number>;
  /** The views when the project has more than one kind (대사 · UI · 문서), with their line counts; `groups` are the open view's. */
  views?: { kind: GroupRow['kind']; lines: number }[];
  /** Project status definitions used to color each scene's actual per-status counts. */
  statuses?: StatusLike[];
  /** + beside the search: a new scene (UI group, document group) of the open view. */
  onCreate?: () => void;
  /** A scene's right-click menu items (edit, add a line, graph, AI summary). */
  menu?: (group: GroupRow) => ReactNode;
}) {
  const sections = useMemo(() => sectionsOf(groups ?? []), [groups]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded(projectId)));
  const toggle = (name: string, open: boolean) =>
    setExpanded((previous) => {
      if (previous.has(name) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(name);
      else next.delete(name);
      try {
        sessionStorage.setItem(storageKey(projectId), JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
      return next;
    });
  // A scene's count is its progress: lines translated (past 미번역), with 확정 named in the hint; the check means all 확정.
  const progressOf = (group: GroupRow) => {
    const lines = Object.entries(group.statuses);
    return { translated: lines.reduce((sum, [id, n]) => sum + (initialIds.has(id) ? 0 : n), 0), final: lines.reduce((sum, [id, n]) => sum + (finalIds.has(id) ? n : 0), 0) };
  };

  const noun = SOURCE_GROUP_LABEL[scope.kind ?? 'scene'];
  const search = (
    <Inline gap="tight">
      <SearchField size="fill" value={gq} onChange={onFilter} placeholder={`${noun} 찾기`} />
      {onCreate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${noun} 추가`} onClick={onCreate}><Plus /></Button>
          </TooltipTrigger>
          <TooltipContent>{noun} 추가</TooltipContent>
        </Tooltip>
      )}
    </Inline>
  );
  const kindsNav = (
    <Box as="nav" aria-label="원본 종류" spaceY="tight">
      {views?.map((view) => <ScopeLink key={view.kind} projectId={projectId} scope={{ kind: view.kind }} clearPeopleFilters={view.kind !== scope.kind} active={!scope.group && !scope.section && !scope.review && scope.kind === view.kind} icon={VIEW_ICON[view.kind]} label={`전체 ${SCRIPT_VIEW[view.kind]}`} count={view.lines} />)}
    </Box>
  );
  const reviewNav = <ScopeLink projectId={projectId} scope={{ review: true }} active={Boolean(scope.review)} icon={Inbox} label="검토함" count={reviewCount} highlight={reviewCount > 0} />;

  return (
    <Stack as="aside" height="full" minHeight={0} background="navigation">
      <Box shrink={false} border="bottom" borderColor="subtle" padding="condensed"><Box spaceY="condensed">{kindsNav}{search}</Box></Box>
      <Box grow minHeight={0} overflow="y" padding="tight">
        {!groups && <Text as="p" paddingX="normal" paddingY="condensed" variant="caption" tone="muted">불러오는 중…</Text>}
        {groups?.length === 0 && <Text as="p" paddingX="normal" paddingY="condensed" variant="body" tone="muted">맞는 항목이 없습니다.</Text>}
        {sections.map((section) => {
          // A scene search shows its matches wherever they are; otherwise sections default to closed unless opened or active.
          const open = Boolean(gq) || !section.name || expanded.has(section.name);
          const items = section.groups.map((group) => <GroupItem key={group.id} menu={menu?.(group)} projectId={projectId} group={group} progress={progressOf(group)} statuses={statuses} active={group.id === scope.group} indent={Boolean(section.name)} marks={marks} />);
          if (!section.name) return <Fragment key={section.key}>{items}</Fragment>;
          const count = section.groups.reduce((sum, group) => sum + group.total, 0);
          const active = scope.section === section.name;
          return <SectionBranch key={section.key} label={section.name} open={open} onOpenChange={(next) => toggle(section.name!, next)} disabled={Boolean(gq)} navigation={
              <ListRow as="link" variant="nav-section" active={active}>
                <ScriptLink projectId={projectId} scope={{ kind: scope.kind, section: section.name }} aria-current={active ? 'page' : undefined}>
                  <Text minWidth={0} grow truncate weight="medium">{section.name}</Text>
                  <Text shrink={false} mono variant="caption" tabular tone="subtle">{count.toLocaleString()}</Text>
                </ScriptLink>
              </ListRow>
            }>
            {items}
          </SectionBranch>;
        })}
      </Box>
      <Box as="footer" shrink={false} border="top" borderColor="subtle" padding="condensed">{reviewNav}</Box>
    </Stack>
  );
}

/** A section of scenes: a fold button and the link that selects the section, the scenes under it. */
function SectionBranch({ label, open, onOpenChange, navigation, disabled, children }: { label: string; open: boolean; onOpenChange: (open: boolean) => void; navigation: ReactNode; disabled: boolean; children: ReactNode }) {
  return (
    <Box marginTop="condensed">
      <ExpandableRow toggle="chevron" open={open} onOpenChange={onOpenChange} disabled={disabled} label={`${open ? '접기' : '펴기'} ${label}`} summary={navigation}>
        {children}
      </ExpandableRow>
    </Box>
  );
}

/** A link that changes what the center shows, keeping the list's own search and its automatic marks. */
function ScriptLink({ projectId, scope, clearPeopleFilters, children, ...props }: { projectId: string; scope: ScriptScope; clearPeopleFilters?: boolean; /** Set by the navigation parts that wrap this link. */ className?: string; children: ReactNode; title?: string; 'aria-current'?: 'page' }) {
  return (
    <Link
      to="/p/$projectId/script"
      params={{ projectId }}
      search={(previous) => ({
        // Navigation changes only the source scope; user filters remain in the URL and Back/Forward.
        gq: previous.gq,
        marks: previous.marks as LineMark[] | undefined,
        q: previous.q,
        statuses: previous.statuses,
        hideStatuses: previous.hideStatuses,
        tags: previous.tags,
        hideTags: previous.hideTags,
        hideMarks: previous.hideMarks as LineMark[] | undefined,
        unfinished: previous.unfinished,
        decidedBy: previous.decidedBy,
        noted: previous.noted,
        excluded: previous.excluded,
        speakers: clearPeopleFilters ? undefined : previous.speakers,
        hideSpeakers: clearPeopleFilters ? undefined : previous.hideSpeakers,
        listener: clearPeopleFilters ? undefined : previous.listener,
        mode: previous.mode === 'find' ? ('find' as const) : undefined,
        group: undefined,
        review: undefined,
        kind: undefined,
        section: undefined,
        ...scope,
      })}
      {...props}
    >
      {children}
    </Link>
  );
}

function ScopeLink({ projectId, scope, active, icon, label, count, highlight, clearPeopleFilters }: { projectId: string; scope: ScriptScope; active: boolean; icon: LucideIcon; label: string; count: number; highlight?: boolean; clearPeopleFilters?: boolean }) {
  return (
    <ListRow as="link" variant="nav" active={active}>
      <ScriptLink projectId={projectId} scope={scope} clearPeopleFilters={clearPeopleFilters} aria-current={active ? 'page' : undefined}>
        <Text><Icon icon={icon} size="sm" tone="muted" /></Text>
        <Text minWidth={0} grow truncate>{label}</Text>
        <Text marginLeft="auto" variant="caption" tabular mono weight={highlight ? 'medium' : undefined} tone={highlight ? 'default' : 'subtle'}>{count.toLocaleString()}</Text>
      </ScriptLink>
    </ListRow>
  );
}

function GroupItem({ projectId, group, progress, statuses, active, indent, marks, menu }: { menu?: ReactNode; projectId: string; group: GroupRow; progress: { translated: number; final: number }; statuses?: StatusLike[]; active: boolean; indent: boolean; marks?: Map<string, number> }) {
  const complete = group.total > 0 && progress.final === group.total;
  const marked = marks?.get(group.id) ?? 0;
  const link = (
    <ListRow as="link" variant="nav-scene" active={active} complete={complete}>
      <ScriptLink projectId={projectId} scope={{ group: group.id }} title={group.title} aria-current={active ? 'page' : undefined}>
        <Inline as="span" minWidth={0} gap="tight">
          <Text minWidth={0} grow truncate>{group.title}</Text>
          {marks ? (
            marked ? <Count tone="warning">{marked}</Count> : null
          ) : complete ? (
            <Icon icon={Check} size="xs" shrink={false} tone="success" aria-label="완료" />
          ) : (
            <Text shrink={false} variant="caption" mono tone="subtle" tabular title={`번역함 ${progress.translated}줄 · 확정 ${progress.final}줄 / 전체 ${group.total}줄`} aria-label={`번역함 ${progress.translated} / ${group.total}`}>
              {progress.translated}/{group.total}
            </Text>
          )}
        </Inline>
        {!marks && statuses?.length ? <Meter statuses={statuses} counts={group.statuses} /> : null}
      </ScriptLink>
    </ListRow>
  );
  if (!menu) return link;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{link}</ContextMenuTrigger>
      <ContextMenuContent width="menu">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}
