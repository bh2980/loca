/** The line filters: the screen's URL search params, the filter menu and the chips that show what is set. */
import { Fragment, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ListFilter } from 'lucide-react';
import { AUTO_MARKS, type AutoMark, LINE_MARK_IDS, type LineMark, parseMarks } from '@tw/shared';
import { LINE_TABS, type LineTab } from '@/components/line-detail';
import { StatusDot } from '@/components/status';
import { markTagGroups } from '@/components/header-filter';
import { Button, Input, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@loca/ui';
import { q } from '@/lib/queries';

export interface LinesSearch {
  q?: string;
  status?: string;
  /** Tag ids: lines carrying all of them (with the automatic marks below, all combine). */
  tags?: string[];
  speaker?: string;
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
  /** The line pane's tab and the AI node whose context it shows ("workflowId:nodeId"). */
  lineTab?: Exclude<LineTab, 'checks'>;
  aiNode?: string;
}

export const linesSearchSchema = (raw: Record<string, unknown>): LinesSearch => ({
  q: typeof raw.q === 'string' && raw.q ? raw.q : undefined,
  status: typeof raw.status === 'string' ? raw.status : undefined,
  tags: Array.isArray(raw.tags) && raw.tags.length && raw.tags.every((id) => typeof id === 'string') ? (raw.tags as string[]) : undefined,
  speaker: typeof raw.speaker === 'string' && raw.speaker ? raw.speaker : undefined,
  listener: typeof raw.listener === 'string' && raw.listener ? raw.listener : undefined,
  marks: parseMarks(raw.marks, LINE_MARK_IDS),
  mode: raw.mode === 'find' ? 'find' : undefined,
  page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
  line: typeof raw.line === 'string' ? raw.line : undefined,
  detail: raw.detail === true || raw.detail === 'true' ? true : undefined,
  lineTab: typeof raw.lineTab === 'string' && LINE_TABS.includes(raw.lineTab as LineTab) && raw.lineTab !== 'checks' ? (raw.lineTab as LinesSearch['lineTab']) : undefined,
  aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
});

/** Whether any line filter is set (search, status, tag, speaker, listener, automatic marks). */
export const hasLineFilter = (search: LinesSearch) => Boolean(search.q || search.status || search.tags?.length || search.speaker || search.listener || search.marks?.length);
/** Whether the filter is walked inside the scenes rather than listed apart. */
export const isFinding = (search: LinesSearch) => hasLineFilter(search) && search.mode === 'find';

/** The set filters as removable chips (also the find bar's label). */
export function filterChips(search: LinesSearch, statuses: { id: string; name: string }[], tags: { id: string; name: string; color: string }[]) {
  return [
    search.status && { key: 'status', label: `상태: ${statuses.find((status) => status.id === search.status)?.name ?? '?'}`, clear: { status: undefined } },
    ...(search.tags ?? []).map((id) => {
      const rest = search.tags!.filter((other) => other !== id);
      return { key: `tag-${id}`, label: `#${tags.find((tag) => tag.id === id)?.name ?? '?'}`, tag: tags.find((tag) => tag.id === id), clear: { tags: rest.length ? rest : undefined } };
    }),
    search.speaker && { key: 'speaker', label: `화자: ${search.speaker}`, clear: { speaker: undefined } },
    search.listener && { key: 'listener', label: `청자: ${search.listener}`, clear: { listener: undefined } },
    ...(search.marks ?? []).map((mark) => {
      const rest = search.marks!.filter((other) => other !== mark);
      return { key: `mark-${mark}`, label: `#${AUTO_MARKS[mark].name}`, mark, clear: { marks: rest.length ? rest : undefined } };
    }),
  ].filter(Boolean) as { key: string; label: string; /** Set for automatic marks / tags: shown as their chip. */ mark?: AutoMark; tag?: { id: string; name: string; color: string }; clear: Partial<LinesSearch> }[];
}

/**
 * Filters the list by status, tag, speaker or listener. Each choice goes into the URL and shows as
 * a removable chip next to the search, like filters that arrive from a link.
 */
export function LineFilters({ projectId, statuses, tags, speakers, search, onSearch }: {
  projectId: string;
  statuses: { id: string; name: string; color: string }[];
  tags: { id: string; name: string; color: string; role?: string | null }[];
  speakers: { name: string; lines: number }[];
  search: LinesSearch;
  onSearch: (next: Partial<LinesSearch>) => void;
}) {
  const [needle, setNeedle] = useState('');
  const shown = speakers.filter((speaker) => !needle || speaker.name.toLowerCase().includes(needle.toLowerCase())).slice(0, 40);
  const toggleTag = (id: string, on: boolean) => {
    const next = on ? [...(search.tags ?? []), id] : (search.tags ?? []).filter((other) => other !== id);
    onSearch({ tags: next.length ? next : undefined });
  };
  const toggleMark = (mark: LineMark, on: boolean) => {
    const next = on ? [...(search.marks ?? []), mark] : (search.marks ?? []).filter((other) => other !== mark);
    onSearch({ marks: next.length ? next : undefined });
  };
  const groups = markTagGroups({ marks: LINE_MARK_IDS, picked: search.marks, onToggle: (mark, on) => toggleMark(mark as LineMark, on), tags, pickedTags: search.tags, onToggleTag: toggleTag, projectId, tagHeading: '내 태그', issueHeading: '문제 유형' });
  return (
    <DropdownMenu onOpenChange={(open) => !open && setNeedle('')}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <ListFilter /> 필터
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70svh] w-56 overflow-y-auto">
        {/* Marks and tags in one list: each check narrows the lines further (all must hold). */}
        {groups.map((group) => (
          <Fragment key={group.heading}>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{group.heading}</DropdownMenuLabel>
            {group.options.map((option) => (
              <DropdownMenuCheckboxItem key={option.key} checked={option.checked} onSelect={(event) => event.preventDefault()} onCheckedChange={option.onChange}>
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
        {!tags.some((tag) => !tag.role) && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">내 태그</DropdownMenuLabel>
            <DropdownMenuItem asChild inset>
              <Link to="/p/$projectId/settings/statuses" params={{ projectId }}>
                태그 만들기
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>상태</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            {statuses.map((status) => (
              <DropdownMenuCheckboxItem key={status.id} checked={search.status === status.id} onCheckedChange={(on) => onSearch({ status: on ? status.id : undefined })}>
                <StatusDot color={status.color} /> {status.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>화자</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <Input value={needle} onChange={(event) => setNeedle(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="이름 찾기" className="mb-1" aria-label="화자 찾기" />
            <div className="max-h-72 overflow-y-auto">
              {shown.map((speaker) => (
                <DropdownMenuCheckboxItem key={speaker.name} checked={search.speaker === speaker.name} onCheckedChange={(on) => onSearch({ speaker: on ? speaker.name : undefined })}>
                  <span className="min-w-0 flex-1 truncate">{speaker.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{speaker.lines.toLocaleString()}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>청자</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {speakers.slice(0, 40).map((speaker) => (
              <DropdownMenuCheckboxItem key={speaker.name} checked={search.listener === speaker.name} onCheckedChange={(on) => onSearch({ listener: on ? speaker.name : undefined })}>
                {speaker.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
