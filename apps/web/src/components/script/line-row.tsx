/** One row of the line list, with the hints and links that open under the picked line. */
import { useMemo, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Ellipsis, PanelRight } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARKS, compileFormatRules, isUnknownListener, lineExclusion, listenerLabel, needsListener, PALETTE, SPECIAL_LISTENERS, TAG_SCOPES, type FormatRules, type LineMark, type ListenerOrigin, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, MarkedSourceText, TokenText } from '@/components/editor/source-text';
import { insertIntoLine } from '@/components/editor/translation-input';
import { LineNote } from '@/components/script/line-note';
import { withoutTokens } from '@/lib/line-context';
import {
  Button,
  Checkbox,
  AiMark,
  StatusIcon,
  TagChip,
  TagSubMenu,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  SpeakerIdentity,
  TranslationRow,
  SceneSectionHeader,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  type StatusLike,
} from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { SOURCE_GROUP_LABEL, SOURCE_UNIT_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { SpeakerCard } from '@/components/script/speaker-card';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { useDraft } from '@/lib/drafts';
import { useSaveLine } from '@/lib/line-save';
import type { InferResponseType } from '@/lib/api';
import { usePersonColors } from '@/lib/person-colors';

/** Who the line is addressed to. Unsure AI guesses count as unknown. */
function listenerText(line: { kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null }, rules: FormatRules | undefined) {
  if (isUnknownListener(line, rules) || !line.listener) return { text: '청자 미상', unknown: true };
  return { text: listenerLabel(line.listener), unknown: false };
}

/** What a line nobody says is, shown where the speaker would be. */

/**
 * The few things worth knowing while typing, as one row under the editor: does the translation
 * keep the speech rule, the confirmed terms and the source's format, and what the last run said.
 * "자세히" opens everything else in the pane.
 */
/**
 * Context and last-run guidance for the selected line's inspector.
 */
export function LineHints({ projectId, line, part }: { projectId: string; line: { id: string; source: string; translation: string | null; speaker?: string | null; listener?: string | null; lastRun: { issues: string[] } | null }; part?: 'context' | 'result' }) {
  const unit = useQuery(q.unit(line.id));
  const people = useQuery(q.characters(projectId));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  const [draft] = useDraft(`line:${line.id}`, line.translation ?? '');
  const text = draft.trim();
  const speech = unit.data?.speech;
  const guessed = text ? speechLevelOf(text) : null;
  // Words inside format tags (<d target="data_cassandra_…">) are not terms.
  const used = useMemo(() => {
    const { placeholder, tag } = compileFormatRules(project.data?.formatRules ?? undefined);
    const plain = [placeholder, tag].reduce((text, pattern) => withoutTokens(text, pattern), line.source);
    return (terms.data ?? []).filter((term) => term.status === 'confirmed' && term.target && mentions(plain, term.source));
  }, [terms.data, line.source, project.data?.formatRules]);

  const hint = (key: string, ok: boolean | null, label: ReactNode, title?: string) => (
    <span key={key} title={title} className={cn('inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs shadow-2xs', ok === false && 'border-warning/40 text-warning')}>
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      {label}
    </span>
  );
  // A term chip puts its translation at the cursor of the line's editor; it turns to a warning when the draft lacks it.
  const termChip = (term: { id: string; source: string; target: string }) => {
    const ok = text ? text.toLowerCase().includes(term.target.toLowerCase()) : null;
    return (
      <Button
        key={term.id}
        type="button"
        variant="ghost"
        size="inline"
        title={ok === false ? '번역에 없음' : undefined}
        onClick={() => { if (!insertIntoLine(line.id, term.target)) toast.info('번역 칸이 열려 있지 않습니다.'); }}
        className={cn('h-auto gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-normal shadow-2xs hover:bg-accent', ok === false && 'border-warning/40 text-warning')}
      >
        {ok === true && <Check className="size-3 text-success" />}
        {ok === false && <CircleAlert className="size-3" />}
        <span>{term.source}</span>
        <span className="text-subtle-foreground">→</span>
        <span className="font-medium">{term.target}</span>
      </Button>
    );
  };
  const context = used.map(termChip);
  // Format checks of the draft sit with the editor (TranslationEditor); here only what the last run said.
  const result = line.lastRun?.issues.slice(0, 1).map((issue) => hint('run', false, issue)) ?? [];
  const items = [...(part !== 'result' ? context : []), ...(part !== 'context' ? result : [])];
  // The speech rule for this speaker → listener, written out under the source (it used to hide in a chip's tooltip).
  const rule = part !== 'result' && speech && (
    <p key="speech" className={cn('flex items-start gap-1 text-xs', guessed && guessed !== speech.level ? 'text-warning' : 'text-muted-foreground')}>
      {guessed === speech.level && <Check className="mt-0.5 size-3 shrink-0 text-success" />}
      {guessed && guessed !== speech.level && <CircleAlert className="mt-0.5 size-3 shrink-0" />}
      <span>
        말투 → {listenerLabel(speech.listener)}
        {speech.level !== 'other' && ` · ${SPEECH_LEVEL_LABELS[speech.level]}`}
        {guessed && guessed !== speech.level && ` (지금 ${SPEECH_LEVEL_LABELS[guessed]})`}
        {speech.rule && speech.rule !== SPEECH_LEVEL_LABELS[speech.level] && ` · ${speech.rule}`}
      </span>
    </p>
  );
  // Who is talking, in a line each: the speaker's habit and how they stand with the listener (the card has the rest).
  const named = (name: string | null | undefined) => {
    const lower = name?.toLowerCase();
    return lower ? people.data?.characters.find((person) => person.name.toLowerCase() === lower || person.aliases.some((alias) => alias.toLowerCase() === lower)) : undefined;
  };
  const speaker = part !== 'result' ? named(line.speaker) : undefined;
  const listener = speaker ? named(line.listener) : undefined;
  const relation = listener && people.data?.relationships.find((item) => (item.fromId === speaker!.id && item.toId === listener.id) || (item.mutual && item.fromId === listener.id && item.toId === speaker!.id));
  const about = [
    speaker?.speech && { key: 'habit', label: `${speaker.name} 말버릇`, text: speaker.speech },
    relation && { key: 'relation', label: `관계 ${speaker!.name} → ${listener!.name}`, text: [relation.kind, relation.description].filter(Boolean).join(' — ') },
  ].filter((item): item is { key: string; label: string; text: string } => !!item);
  if (!rule && !about.length && !items.some(Boolean)) return null;
  return (
    <div className="mt-2 space-y-1.5" onClick={(event) => event.stopPropagation()}>
      {/* Under the source: its term chips first (they match the underlines), then who is talking. */}
      {items.some(Boolean) && <div className="flex flex-wrap items-center gap-1.5">{items}</div>}
      {/* Who is talking is a group of its own: tighter lines inside, more room above when chips come first. */}
      {(rule || about.length > 0) && (
        <div className={cn('space-y-0.5', items.some(Boolean) && 'pt-1.5')}>
          {rule}
          {about.map((item) => (
            <p key={item.key} className="line-clamp-1 text-xs text-muted-foreground" title={item.text}>
              {item.label} · {item.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

type LineTag = StatusLike & { role?: string | null };
type Line = InferResponseType<(typeof client.projects)[':projectId']['units']['$get']> extends { rows: (infer Row)[] } ? Row : never;

/** One line of the list: a compact row, or the open editor when picked. */
export function LineRow({
  projectId,
  line,
  newScene,
  sceneSelection,
  selected,
  marked,
  findLabel,
  status,
  statusList,
  tags,
  tokenPattern,
  review,
  isPicked,
  arrived,
  rowRef,
  noting,
  focusTick,
  onPick,
  onSelect,
  onOpenDetail,
  onShowInGraph,
  onAddLine,
  onEditSource,
  onOpenScene,
  onArrivedEnd,
  onNoting,
  onEscape,
  onDone,
  onFilterTag,
  onFilterMark,
}: {
  projectId: string;
  line: Line;
  /** The line starts a new scene (shown with its title above). */
  newScene: boolean;
  sceneSelection?: { checked: boolean | 'indeterminate'; disabled: boolean; count?: string; onChange: (selected: boolean) => void };
  selected: boolean;
  marked: boolean | undefined;
  findLabel?: string;
  status: { name: string; color: string } | undefined;
  statusList: ComponentProps<typeof TranslationEditor>['statuses'];
  tags: LineTag[];
  tokenPattern: RegExp | null;
  review?: boolean;
  isPicked: boolean;
  /** Brought here from a link: flashes once. */
  arrived: boolean;
  rowRef?: RefObject<HTMLLIElement | null>;
  noting: boolean;
  focusTick: number;
  onPick: (on: boolean) => void;
  onSelect: () => void;
  onOpenDetail?: () => void;
  onShowInGraph?: () => void;
  /** Adds a line at the end of this line's scene (its source editor opens). */
  onAddLine?: () => void;
  /** Opens this line's source (text, speaker, key) in the editor. */
  onEditSource?: () => void;
  onOpenScene?: (groupId: string, lineId: string) => void;
  onArrivedEnd: () => void;
  onNoting: (noting: boolean) => void;
  onEscape: () => void;
  onDone: (advanced: boolean) => void;
  onFilterTag: (tagId: string) => void;
  onFilterMark: (mark: LineMark) => void;
}) {
  const project = useQuery(q.project(projectId)).data;
  const rules = project?.formatRules ?? undefined;
  // 번역 제외: hidden from the list by default (the 숨기기 filter); shown on request, it carries its mark.
  const excluded = lineExclusion(line, rules, project?.exclusionRules, project?.sourceLanguage) !== null;
  // Narration and lines of format tokens only are said to nobody: no listener slot, unless a person or the import gave one.
  const said = needsListener(line, rules) || (Boolean(line.listener) && (line.listenerOrigin === 'human' || line.listenerOrigin === 'import'));
  const who = listenerText(line, rules);
  const marks: LineMark[] = [];
  if (excluded) marks.push('excluded');
  if (line.note.trim()) marks.push('noted');
  const attachedTags = tags.filter((tag) => line.tagIds.includes(tag.id));
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];

  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (json: { tagIds?: string[]; translate?: 'include' | 'exclude' }) => unwrap(client.units[':unitId'].$patch({ param: { unitId: line.id }, json })),
    onMutate: async (json) => ({ undo: await optimistic(queryClient, unitChanges([line.id], patchedLine(json))) }),
    onError: (error, _json, context) => {
      context?.undo();
      toast.error(error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['statuses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['units', projectId] });
      queryClient.invalidateQueries({ queryKey: ['unit', line.id] });
    },
  });

  const handleToggleTag = (tagId: string, add: boolean) => {
    const nextTagIds = add ? [...line.tagIds, tagId] : line.tagIds.filter((id) => id !== tagId);
    patch.mutate({ tagIds: nextTagIds });
  };

  const handleCreateTag = async (name: string) => {
    try {
      const color = (PALETTE[tags.length % PALETTE.length] as any).light ?? PALETTE[tags.length % PALETTE.length].hex;
      const res = await unwrap(client.projects[':projectId'].tags.$post({
        param: { projectId },
        json: { name, color, scope: [...TAG_SCOPES] },
      }));
      await patch.mutateAsync({ tagIds: [...line.tagIds, res.id] });
      toast.success(`'${name}' 태그를 만들고 줄에 붙였습니다.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '태그를 만들지 못했습니다.');
    }
  };

  const tagRow = marks.length || orderedTags.length ? (
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="이 줄의 태그" onClick={(event) => event.stopPropagation()}>
      {marks.map((mark) => (
        <Button key={mark} variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" title={`#${AUTO_MARKS[mark].name} 줄만 보기`} onClick={() => onFilterMark(mark)}>
          <MarkChip mark={mark} projectId={projectId} />
        </Button>
      ))}
      {orderedTags.map((tag) => (
        <Button key={tag.id} variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" title={`#${tag.name} 줄만 보기`} onClick={() => onFilterTag(tag.id)}>
          <TagChip tag={tag} />
        </Button>
      ))}
    </div>
  ) : null;
  // Lines nobody says read apart from dialogue without a label on every row: narration is muted
  // (stage directions), a document reads as prose, a UI string is one dense row with its key.
  const narration = line.kind === 'dialogue' && !line.speaker?.trim();
  const sourceClass = narration ? 'text-muted-foreground' : line.kind === 'document' ? 'leading-relaxed' : undefined;
  const header = newScene && (
    <li className="group/scene mx-3 my-3 select-none">
      <SceneSectionHeader
        title={line.groupTitle}
        count={sceneSelection?.count}
        checkbox={sceneSelection && <Checkbox aria-label={`${line.groupTitle} 현재 검색 조건에 맞는 모든 줄 선택${sceneSelection.count ? `, ${sceneSelection.count}` : ''}`} checked={sceneSelection.checked} disabled={sceneSelection.disabled} onCheckedChange={(checked) => sceneSelection.onChange(checked === true)} />}
        trailing={onOpenScene && <Button variant="ghost" size="inline" onClick={() => onOpenScene(line.groupId, line.id)}>{SOURCE_GROUP_LABEL[line.groupKind]} 열기</Button>}
        className="rounded-md bg-muted/50 py-2.5 text-sm ring-1 ring-inset ring-border"
      />
    </li>
  );
  const checkbox = <Checkbox aria-label={`${line.key} 선택`} checked={isPicked} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onPick(Boolean(checked))} />;
  const colorOf = usePersonColors(projectId);
  const addLineLabel = `이 ${SOURCE_GROUP_LABEL[line.groupKind]}에 ${SOURCE_UNIT_LABEL[line.groupKind]} 추가`;
  // Lines without a speaker (UI strings, documents) show their key in its place, level with the status opposite.
  const speaker = line.kind === 'ui' || line.kind === 'document' ? (
    <span className="truncate font-mono text-xs text-muted-foreground" title={line.key}>{line.key}</span>
  ) : line.speaker ? (
    <SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} color={colorOf(line.speaker)} listener={said ? (who.unknown ? null : who.text) : undefined} listenerIsPerson={!line.listener || !Object.hasOwn(SPECIAL_LISTENERS, line.listener) && !who.unknown} /></SpeakerCard>
  ) : line.kind === 'dialogue' ? <SpeakerIdentity speaker={null} /> : null;
  const identity = (
    <div className="flex min-w-0 items-center gap-1.5">
      {speaker}
      {marked && <span className="shrink-0 text-warning">● {findLabel}</span>}
    </div>
  );
  const statusContent = <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><StatusIcon status={status} /><span className="truncate">{status?.name}</span></span>;
  const aiMeta = line.statusBy === 'ai' ? (
    <Button variant="ghost" size="inline" className="h-auto p-0 hover:bg-transparent" title={`#${AUTO_MARKS.ai.name} 줄만 보기`} onClick={(event) => (event.stopPropagation(), onFilterMark('ai'))}>
      <AiMark by="ai" />
    </Button>
  ) : null;
  // The line's actions sit at the right end of the header of the picked row: the details pane, and everything else in ⋯.
  const actions = selected ? (
    <span className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
      {onOpenDetail && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="상세 열기" onClick={onOpenDetail}>
              <PanelRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>상세 열기</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="줄 동작">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>줄 동작</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
          <TagSubMenu
            tags={tags.filter((tag) => !tag.role)}
            state={(tagId) => (line.tagIds.includes(tagId) ? 'all' : 'none')}
            onToggle={handleToggleTag}
            onCreate={handleCreateTag}
            heading="태그"
          />
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={excluded ? 'exclude' : 'include'} onValueChange={(value) => patch.mutate({ translate: value as 'include' | 'exclude' })}>
            <DropdownMenuRadioItem value="include">번역 대상</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="exclude">제외</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(line.source); toast.success('원문을 복사했습니다.'); }}>원문 복사</DropdownMenuItem>
          {line.translation && <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(line.translation!); toast.success('번역을 복사했습니다.'); }}>번역 복사</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(line.key); toast.success('대사 키를 복사했습니다.'); }}>키 복사</DropdownMenuItem>
          {onShowInGraph && <DropdownMenuItem onClick={onShowInGraph}>그래프에서 보기</DropdownMenuItem>}
          {(onEditSource || onAddLine) && <DropdownMenuSeparator />}
          {onEditSource && <DropdownMenuItem onClick={onEditSource}>원문 편집</DropdownMenuItem>}
          {onAddLine && <DropdownMenuItem onClick={onAddLine}>{addLineLabel}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  ) : null;
  const source = selected ? (
    <>
      <LineSourceText projectId={projectId} unitId={line.id} source={line.source} translation={line.translation} className={cn('text-base leading-6', sourceClass)} />
      <LineHints projectId={projectId} line={{ id: line.id, source: line.source, translation: line.translation, speaker: line.speaker, listener: line.listener, lastRun: null }} part="context" />
      <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={onNoting} />
    </>
  ) : <MarkedSourceText projectId={projectId} text={line.source} pattern={tokenPattern} className={cn(sourceClass)} />;
  const translation = selected ? (
    <>
      <TranslationEditor key={`editor-${line.id}`} projectId={projectId} unit={line} statuses={statusList} focusKey={focusTick} marks={tagRow} onEscape={onEscape} onDone={onDone} />
      {review && !!line.lastRun?.issues.length && <ReviewIssue issue={line.lastRun.issues[0]} />}
    </>
  ) : (
    <>
      {line.translation ? <TokenText text={line.translation} source={line.source} pattern={tokenPattern} /> : <span className="text-subtle-foreground select-none">미번역</span>}
      {review && !!line.lastRun?.issues.length && <ReviewIssue issue={line.lastRun.issues[0]} />}
      {tagRow}
    </>
  );
  const compact = line.kind === 'ui' && !selected && !review;
  const row = (
    <TranslationRow
      checkbox={checkbox}
      speaker={identity}
      status={statusContent}
      meta={aiMeta || actions ? <>{aiMeta}{actions}</> : null}
      source={source}
      translation={translation}
      selected={selected}
      compact={compact}
      layout="grid"
      className={cn(selected ? 'bg-selection' : 'cursor-pointer hover:bg-accent', marked && !selected && 'bg-warning/5')}
    />
  );
  const saveLine = useSaveLine();

  return (
    <>
      {header}
      <li
        ref={rowRef}
        onClick={onSelect}
        className={cn('transition-colors', selected ? 'bg-selection' : 'cursor-pointer', marked && !selected && 'bg-warning/5')}
        style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
        onAnimationEnd={onArrivedEnd}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="w-full">
              {row}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={onSelect}>
              번역 편집
            </ContextMenuItem>
            {onOpenDetail && (
              <ContextMenuItem onClick={onOpenDetail}>
                상세 열기
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>상태 변경</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                {statusList.map((s) => (
                  <ContextMenuCheckboxItem
                    key={s.id}
                    checked={line.statusId === s.id}
                    onCheckedChange={() => {
                      if (line.statusId !== s.id) {
                        saveLine.mutate({ unitId: line.id, text: line.translation ?? '', statusId: s.id });
                      }
                    }}
                  >
                    <StatusIcon status={s} />
                    <span className="truncate">{s.name}</span>
                  </ContextMenuCheckboxItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>태그</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                {tags.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">태그 없음</div>
                ) : (
                  tags.map((tag) => (
                    <ContextMenuCheckboxItem
                      key={tag.id}
                      checked={line.tagIds.includes(tag.id)}
                      onCheckedChange={(checked) => handleToggleTag(tag.id, Boolean(checked))}
                    >
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="truncate">{tag.name}</span>
                    </ContextMenuCheckboxItem>
                  ))
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(line.source);
                toast.success('원문을 복사했습니다.');
              }}
            >
              원문 복사
            </ContextMenuItem>
            {line.translation && (
              <ContextMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(line.translation!);
                  toast.success('번역을 복사했습니다.');
                }}
              >
                번역 복사
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(line.key);
                toast.success('대사 키를 복사했습니다.');
              }}
            >
              키 복사
            </ContextMenuItem>
            {onShowInGraph && (
              <ContextMenuItem onClick={onShowInGraph}>
                그래프에서 보기
              </ContextMenuItem>
            )}
            {(onEditSource || onAddLine) && <ContextMenuSeparator />}
            {onEditSource && <ContextMenuItem onClick={onEditSource}>원문 편집</ContextMenuItem>}
            {onAddLine && <ContextMenuItem onClick={onAddLine}>{addLineLabel}</ContextMenuItem>}
          </ContextMenuContent>
        </ContextMenu>
      </li>
    </>
  );
}

function ReviewIssue({ issue }: { issue: string }) {
  return <p className="mt-1 flex items-start gap-1 text-xs text-warning"><CircleAlert className="mt-0.5 size-3 shrink-0" /><span className="line-clamp-2">{issue}</span></p>;
}
