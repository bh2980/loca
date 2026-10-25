/** The line filters: the screen's URL search params, the filter menu and the chips that show what is set. */
import { Fragment, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { AUTO_MARKS, type AutoMark, LINE_MARK_IDS, type LineMark, parseMarks } from '@tw/shared';
import { FilterModeSwitch, markTagGroups, pickOf, PickIcon, togglePick, type FilterPick } from '@/components/header-filter';
import { knownListenerFilter, toggleLineMarkFilter, unknownListenerFilter } from '@/lib/line-filter-state';
import { Box, Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuTrigger, Inline, ScriptFilterGroupLabel, ScriptFilterMenuContent, ScriptFilterSubmenuContent, ScriptInput, StatusIcon, Text } from '@loca/ui';
import { q } from '@/lib/queries';
import { PersonName } from '@/lib/person-colors';

export interface LinesSearch {
  q?: string;
  /** Status ids: lines in any of them. */
  statuses?: string[];
  /** Tag ids: lines carrying all of them (with the automatic marks below, all combine). */
  tags?: string[];
  /** Speaker names: lines by any of them. */
  speakers?: string[];
  /** 숨기기: lines in any of these statuses, by any of these speakers, or with any of these tags are left out. */
  hideStatuses?: string[];
  hideSpeakers?: string[];
  hideTags?: string[];
  /** Hidden marks; absent = the default (#번역 제외 hidden), an empty list = nothing hidden. */
  hideMarks?: LineMark[];
  /** A character name (a known listener); unknown listeners are the unknownListener mark. */
  listener?: string;
  /** Automatic marks (LINE_MARK_IDS): lines carrying every one of them. */
  marks?: LineMark[];
  /**
   * How a filter shows: listed apart (the default: only the matching lines) or, with mode=find, walked one by one
   * inside their scenes (find, '장면에서 찾아가기', when the conversation around them matters).
   */
  mode?: 'find';
  page?: number;
  line?: string;
  /** The line's details pane is open (closed by default: the row itself is the editor). */
  detail?: true;
  /** The AI node whose prompt context the line pane previews ("workflowId:nodeId"). */
  aiNode?: string;
}

const strings = (value: unknown) => (Array.isArray(value) && value.length && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined);

/** The marks hidden when the URL says nothing: lines not for translation. */
export const DEFAULT_HIDDEN_MARKS: LineMark[] = ['excluded'];
export const hiddenMarksOf = (search: LinesSearch) => search.hideMarks ?? DEFAULT_HIDDEN_MARKS;

export const linesSearchSchema = (raw: Record<string, unknown>): LinesSearch => ({
  q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  statuses: strings(raw.statuses),
  tags: strings(raw.tags),
  speakers: strings(raw.speakers),
  hideStatuses: strings(raw.hideStatuses),
  hideSpeakers: strings(raw.hideSpeakers),
  hideTags: strings(raw.hideTags),
  // An empty list is kept: it says "hide nothing" over the default.
  hideMarks: Array.isArray(raw.hideMarks) ? (parseMarks(raw.hideMarks, LINE_MARK_IDS) ?? []) : undefined,
  listener: typeof raw.listener === 'string' && raw.listener ? raw.listener : undefined,
  marks: parseMarks(raw.marks, LINE_MARK_IDS),
  mode: raw.mode === 'find' ? 'find' : undefined,
  page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
  line: typeof raw.line === 'string' ? raw.line : undefined,
  detail: raw.detail === true || raw.detail === 'true' ? true : undefined,
  aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
});

/** The list query's filter params (the server's listQuery): lists of ids comma-joined, names as JSON (a name may hold a comma). */
export function lineQueryParams(search: LinesSearch) {
  const names = (list: string[] | undefined) => (list?.length ? JSON.stringify(list) : undefined);
  return {
    q: search.q,
    marks: search.marks?.join(','),
    hideMarks: hiddenMarksOf(search).join(',') || undefined,
    statusIds: search.statuses?.join(','),
    hideStatusIds: search.hideStatuses?.join(','),
    tagIds: search.tags?.join(','),
    hideTagIds: search.hideTags?.join(','),
    speakers: names(search.speakers),
    hideSpeakers: names(search.hideSpeakers),
    listener: search.listener,
  };
}

/** Whether any line filter is set (search, status, tag, speaker, listener, automatic marks). */
export const hasLineFilter = (search: LinesSearch) => Boolean(search.q || search.statuses?.length || search.tags?.length || search.speakers?.length || search.listener || search.marks?.length || search.hideStatuses?.length || search.hideSpeakers?.length || search.hideTags?.length);
/** Whether the filter is walked inside the scenes rather than listed apart. */
export const isFinding = (search: LinesSearch) => hasLineFilter(search) && search.mode === 'find';

/** The set filters as removable chips (also the find bar's label). */
export interface LineFilterChip {
  key: string;
  label: string;
  /** A 숨기기 pick: shown with an eye shut. */
  hidden?: boolean;
  /** Set for automatic marks / tags: shown in their colour. */
  mark?: AutoMark;
  tag?: { id: string; name: string; color: string };
  clear: Partial<LinesSearch>;
}

/** The set filters as removable chips (also the find bar's label). Removing a hidden mark keeps the list explicit, so the default does not come back. */
export function filterChips(search: LinesSearch, statuses: { id: string; name: string }[], tags: { id: string; name: string; color: string }[]): LineFilterChip[] {
  const without = <T,>(list: readonly T[] | undefined, value: T) => {
    const rest = (list ?? []).filter((item) => item !== value);
    return rest.length ? rest : undefined;
  };
  const statusName = (id: string) => statuses.find((status) => status.id === id)?.name ?? '?';
  const tagOf = (id: string) => tags.find((tag) => tag.id === id);
  const hiddenMarks = hiddenMarksOf(search);
  return [
    ...(search.statuses ?? []).map((id) => ({ key: `status-${id}`, label: `상태: ${statusName(id)}`, clear: { statuses: without(search.statuses, id) } })),
    ...(search.hideStatuses ?? []).map((id) => ({ key: `hide-status-${id}`, label: `상태: ${statusName(id)}`, hidden: true, clear: { hideStatuses: without(search.hideStatuses, id) } })),
    ...(search.tags ?? []).map((id) => ({ key: `tag-${id}`, label: `#${tagOf(id)?.name ?? '?'}`, tag: tagOf(id), clear: { tags: without(search.tags, id) } })),
    ...(search.hideTags ?? []).map((id) => ({ key: `hide-tag-${id}`, label: `#${tagOf(id)?.name ?? '?'}`, tag: tagOf(id), hidden: true, clear: { hideTags: without(search.hideTags, id) } })),
    ...(search.speakers ?? []).map((name) => ({ key: `speaker-${name}`, label: `화자: ${name}`, clear: { speakers: without(search.speakers, name) } })),
    ...(search.hideSpeakers ?? []).map((name) => ({ key: `hide-speaker-${name}`, label: `화자: ${name}`, hidden: true, clear: { hideSpeakers: without(search.hideSpeakers, name) } })),
    ...(search.listener ? [{ key: 'listener', label: `청자: ${search.listener}`, clear: { listener: undefined } }] : []),
    ...(search.marks ?? []).map((mark) => ({ key: `mark-${mark}`, label: `#${AUTO_MARKS[mark].name}`, mark, clear: { marks: without(search.marks, mark) } })),
    ...hiddenMarks.map((mark) => ({ key: `hide-mark-${mark}`, label: `#${AUTO_MARKS[mark].name}`, mark, hidden: true, clear: { hideMarks: hiddenMarks.filter((other) => other !== mark) } })),
  ];
}

/**
 * Filters the list by status, tag, speaker or listener. Each choice goes into the URL and shows as
 * a removable chip next to the search, like filters that arrive from a link.
 */
export function LineFilters({ projectId, statuses, tags, speakers, listeners, unknownListenerCount, listenersPending, listenersError, onRetryListeners, withSpeakers = true, search, onSearch }: {
  projectId: string;
  statuses: { id: string; name: string; color: string }[];
  tags: { id: string; name: string; color: string; role?: string | null }[];
  speakers: { name: string; lines: number }[];
  listeners: { name: string; lines: number }[];
  unknownListenerCount: number;
  listenersPending: boolean;
  listenersError: boolean;
  onRetryListeners: () => void;
  /** Speaker and listener filters apply only to dialogue source. */
  withSpeakers?: boolean;
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>) => void;
}) {
  const [speakerNeedle, setSpeakerNeedle] = useState('');
  const [listenerNeedle, setListenerNeedle] = useState('');
  const shownSpeakers = speakers.filter((speaker) => !speakerNeedle || speaker.name.toLowerCase().includes(speakerNeedle.toLowerCase())).slice(0, 40);
  const shownListeners = listeners.filter((listener) => !listenerNeedle || listener.name.toLowerCase().includes(listenerNeedle.toLowerCase())).slice(0, 40);
  // Each menu picks in one mode at a time; it opens on 이것만 보기.
  const [statusMode, setStatusMode] = useState<FilterPick>('show');
  const [speakerMode, setSpeakerMode] = useState<FilterPick>('show');
  const [tagMode, setTagMode] = useState<FilterPick>('show');
  const pickTag = (id: string, mode: FilterPick) => {
    const next = togglePick(search.tags, search.hideTags, id, mode);
    onSearch({ tags: next.show, hideTags: next.hide });
  };
  const pickMark = (mark: LineMark, mode: FilterPick) => {
    const hidden = hiddenMarksOf(search);
    if (mode === 'show' && !search.marks?.includes(mark)) return onSearch({ ...toggleLineMarkFilter(search, mark, true), hideMarks: hidden.filter((other) => other !== mark) });
    if (mode === 'show') return onSearch(toggleLineMarkFilter(search, mark, false));
    // Hidden: out of the shown marks; the list stays explicit (an empty one hides nothing).
    const next = togglePick(search.marks, hidden, mark, 'hide');
    onSearch({ marks: next.show, hideMarks: next.hide ?? [] });
  };
  const groups = markTagGroups({ marks: LINE_MARK_IDS, picked: search.marks, hidden: hiddenMarksOf(search), onMark: (mark, mode) => pickMark(mark as LineMark, mode), tags, pickedTags: search.tags, hiddenTags: search.hideTags, onTag: pickTag, projectId, tagHeading: '내 태그', issueHeading: '문제 유형' });
  return (
    <Inline minWidth={0} gap="hair">
      <DropdownMenu onOpenChange={(open) => open && setStatusMode('show')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" tone="muted">상태 <ChevronDown /></Button>
        </DropdownMenuTrigger>
        <ScriptFilterMenuContent align="start" width="wide">
          <Box padding="tight"><FilterModeSwitch mode={statusMode} onMode={setStatusMode} /></Box>
          <DropdownMenuGroup>
            {statuses.map((status) => (
              <DropdownMenuItem
                key={status.id}
                onSelect={(event) => {
                  event.preventDefault();
                  const next = togglePick(search.statuses, search.hideStatuses, status.id, statusMode);
                  onSearch({ statuses: next.show, hideStatuses: next.hide });
                }}
              >
                <PickIcon state={pickOf(search.statuses, search.hideStatuses, status.id)} />
                <StatusIcon status={status} /> {status.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </ScriptFilterMenuContent>
      </DropdownMenu>
      {withSpeakers && <DropdownMenu onOpenChange={(open) => (open ? setSpeakerMode('show') : (setSpeakerNeedle(''), setListenerNeedle('')))}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" tone="muted">화자 <ChevronDown /></Button>
        </DropdownMenuTrigger>
        <ScriptFilterMenuContent align="start" width="narrow">
          <Box padding="tight"><FilterModeSwitch mode={speakerMode} onMode={setSpeakerMode} /></Box>
          <ScriptInput place="menuSearch" value={speakerNeedle} onChange={(event) => setSpeakerNeedle(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="이름 찾기" aria-label="화자 찾기" />
          {shownSpeakers.map((speaker) => (
            <DropdownMenuItem
              key={speaker.name}
              onSelect={(event) => {
                event.preventDefault();
                const next = togglePick(search.speakers, search.hideSpeakers, speaker.name, speakerMode);
                onSearch({ speakers: next.show, hideSpeakers: next.hide });
              }}
            >
              <PickIcon state={pickOf(search.speakers, search.hideSpeakers, speaker.name)} />
              <Text asChild minWidth={0} grow truncate><PersonName projectId={projectId} name={speaker.name} /></Text>
              <Text variant="caption" tone="muted" tabular>{speaker.lines.toLocaleString()}</Text>
            </DropdownMenuItem>
          ))}
          {shownSpeakers.length === 0 && <Text as="p" paddingX="condensed" paddingY="tight" variant="caption" tone="muted">일치하는 화자가 없습니다.</Text>}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>청자</DropdownMenuSubTrigger>
            <ScriptFilterSubmenuContent>
              <ScriptInput place="menuSearch" value={listenerNeedle} onChange={(event) => setListenerNeedle(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="이름 찾기" aria-label="청자 찾기" />
              <DropdownMenuCheckboxItem checked={Boolean(search.marks?.includes('unknownListener'))} onSelect={(event) => event.preventDefault()} onCheckedChange={(on) => onSearch(unknownListenerFilter(search, on))}>
                <Text minWidth={0} grow truncate>청자 미상</Text>
                {!listenersPending && !listenersError && <Text variant="caption" tone="muted" tabular>{unknownListenerCount.toLocaleString()}</Text>}
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {listenersPending && <Text as="p" role="status" paddingX="condensed" paddingY="tight" variant="caption" tone="muted">청자 목록을 불러오는 중…</Text>}
              {listenersError && (
                <>
                  <Text as="p" role="alert" paddingX="condensed" paddingY="tight" variant="caption" tone="muted">청자 목록을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.</Text>
                  <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onRetryListeners(); }}>다시 시도</DropdownMenuItem>
                </>
              )}
              {!listenersPending && !listenersError && shownListeners.map((listener) => (
                <DropdownMenuCheckboxItem key={listener.name} checked={search.listener === listener.name} onSelect={(event) => event.preventDefault()} onCheckedChange={(on) => onSearch(knownListenerFilter(search, listener.name, on))}>
                  <Text minWidth={0} grow truncate>{listener.name}</Text>
                  <Text variant="caption" tone="muted" tabular>{listener.lines.toLocaleString()}</Text>
                </DropdownMenuCheckboxItem>
              ))}
              {!listenersPending && !listenersError && shownListeners.length === 0 && <Text as="p" paddingX="condensed" paddingY="tight" variant="caption" tone="muted">{listeners.length === 0 && !listenerNeedle ? '정해진 청자가 없습니다.' : '일치하는 청자가 없습니다.'}</Text>}
            </ScriptFilterSubmenuContent>
          </DropdownMenuSub>
        </ScriptFilterMenuContent>
      </DropdownMenu>}
      <DropdownMenu onOpenChange={(open) => open && setTagMode('show')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" tone="muted">태그 <ChevronDown /></Button>
        </DropdownMenuTrigger>
        <ScriptFilterMenuContent align="start" width="wide">
          <Box padding="tight"><FilterModeSwitch mode={tagMode} onMode={setTagMode} /></Box>
          {/* Automatic marks, user tags and issue types: shown ones narrow the list together, hidden ones leave lines out. */}
          {groups.map((group) => (
            <Fragment key={group.heading}>
              <ScriptFilterGroupLabel>{group.heading}</ScriptFilterGroupLabel>
              {group.options.map((option) => (
                <DropdownMenuItem key={option.key} onSelect={(event) => { event.preventDefault(); option.onPick(tagMode); }}>
                  <PickIcon state={option.state} />
                  {option.label}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
          {!tags.some((tag) => !tag.role) && (
            <>
              <ScriptFilterGroupLabel>내 태그</ScriptFilterGroupLabel>
              <DropdownMenuItem asChild inset>
                <Link to="/p/$projectId/settings/statuses" params={{ projectId }}>태그 만들기</Link>
              </DropdownMenuItem>
            </>
          )}
        </ScriptFilterMenuContent>
      </DropdownMenu>
    </Inline>
  );
}
