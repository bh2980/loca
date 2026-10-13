/** One row of the line list, with the hints and links that open under the picked line. */
import { useMemo, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CircleAlert, Network, PanelRightOpen, StickyNote } from 'lucide-react';
import { AUTO_MARKS, checkFormat, compileFormatRules, isUnknownListener, listenerLabel, type LineMark, type ListenerOrigin, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { MarkChip, StatusDot, TagChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, TokenText } from '@/components/editor/source-text';
import { LineNote } from '@/components/script/line-note';
import { editorChecks, withoutTokens } from '@/lib/line-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { SpeakerCard } from '@/components/script/speaker-card';
import type { InferResponseType } from '@/lib/api';

/** Who the line is addressed to. Unsure AI guesses count as unknown. */
function listenerText(line: { kind: string; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null }) {
  if (isUnknownListener(line) || !line.listener) return { text: '청자 미상', unknown: true };
  return { text: listenerLabel(line.listener), unknown: false };
}

/** What a line nobody says is, shown where the speaker would be. */
const UNSPOKEN: Record<string, string> = { dialogue: '지문', ui: 'UI', document: '문서' };

/**
 * The few things worth knowing while typing, as one row under the editor: does the translation
 * keep the speech rule, the confirmed terms and the source's format, and what the last run said.
 * "자세히" opens everything else in the pane.
 */
/**
 * What to keep in mind while typing a line: its speech level, the confirmed terms it uses, format
 * problems in the draft and the last run's issue. Links to elsewhere are LineLinks, by the speaker.
 */
export function LineHints({ projectId, line }: { projectId: string; line: { id: string; source: string; translation: string | null; lastRun: { issues: string[] } | null } }) {
  const unit = useQuery(q.unit(line.id));
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
  const format = text ? checkFormat(line.source, draft, editorChecks(project.data?.targetLanguage), project.data?.formatRules) : [];

  const hint = (key: string, ok: boolean | null, label: ReactNode, title?: string) => (
    <span key={key} title={title} className={cn('inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs', ok === false && 'border-warning/40 text-warning')}>
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      {label}
    </span>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
      {speech && speech.level !== 'other' && hint('speech', guessed ? guessed === speech.level : null, `말투: ${SPEECH_LEVEL_LABELS[speech.level]}${guessed && guessed !== speech.level ? ` (지금 ${SPEECH_LEVEL_LABELS[guessed]})` : ''}`, speech.rule)}
      {used.map((term) => hint(term.id, text ? text.toLowerCase().includes(term.target.toLowerCase()) : null, `${term.source} → ${term.target}`))}
      {format.map((issue) => hint(issue.code, false, issue.message))}
      {line.lastRun?.issues.slice(0, 1).map((issue) => hint('run', false, issue))}
    </div>
  );
}

/** Where else the picked line can be seen: its place in the dialogue graph, and the line pane (checks, candidates, history). */
function LineLinks({ projectId, unitId, hasNote, onNote, onDetail }: { projectId: string; unitId: string; hasNote: boolean; onNote: () => void; onDetail: () => void }) {
  const unit = useQuery(q.unit(unitId));
  const node = unit.data?.graphNodes[0];
  const tip = (label: string, button: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    // Full-size icon buttons on the small speaker line; the negative margin keeps the line's height.
    <span className="-my-2 ml-auto flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
      {node &&
        tip(
          '그래프에서 보기',
          // The other way round from the graph's "번역 화면에서 열기": this line where it sits in the flow.
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="그래프에서 보기" asChild>
            <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: unit.data!.groupId, node: node.id, jump: true }}>
              <Network />
            </Link>
          </Button>,
        )}
      {!hasNote &&
        tip(
          '메모 남기기',
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="메모 남기기" onClick={onNote}>
            <StickyNote />
          </Button>,
        )}
      {tip(
        '자세히 · 검사·후보·이력',
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="자세히" onClick={onDetail}>
          <PanelRightOpen />
        </Button>,
      )}
    </span>
  );
}

type LineTag = ComponentProps<typeof TagChip>['tag'] & { role?: string | null };
type Line = InferResponseType<(typeof client.projects)[':projectId']['units']['$get']> extends { rows: (infer Row)[] } ? Row : never;

/** One line of the list: a compact row, or the open editor when picked. */
export function LineRow({ projectId, line, newScene, selected, marked, findLabel, status, statusList, tags, tokenPattern, review, isPicked, arrived, rowRef, noting, focusTick, onPick, onSelect, onOpenScene, onArrivedEnd, onNoting, onDetail, onEscape, onDone, onFilterTag, onFilterMark }: {
  projectId: string;
  line: Line;
  /** The line starts a new scene (shown with its title above). */
  newScene: boolean;
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
  onOpenScene?: (groupId: string, lineId: string) => void;
  onArrivedEnd: () => void;
  onNoting: (noting: boolean) => void;
  onDetail: () => void;
  onEscape: () => void;
  onDone: (advanced: boolean) => void;
  onFilterTag: (tagId: string) => void;
  onFilterMark: (mark: LineMark) => void;
}) {
  const who = listenerText(line);
  const marks: LineMark[] = [];
  if (isUnknownListener(line)) marks.push('unknownListener');
  if (line.statusBy === 'ai') marks.push('ai');
  if (line.note.trim()) marks.push('noted');
  const attachedTags = tags.filter((tag) => line.tagIds.includes(tag.id));
  const orderedTags = [...attachedTags.filter((tag) => tag.role), ...attachedTags.filter((tag) => !tag.role)];
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
  return (
                <>
                {newScene && (
                  <li className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/80 px-4 py-1 text-xs text-muted-foreground backdrop-blur">
                    <span className="truncate font-medium text-foreground">{line.groupTitle}</span>
                    {onOpenScene && (
                      <Button variant="ghost" size="inline" className="ml-auto" onClick={() => onOpenScene(line.groupId, line.id)}>
                        장면 열기
                      </Button>
                    )}
                  </li>
                )}
                <li
                  ref={rowRef}
                  onClick={() => !selected && onSelect()}
                  className={cn('flex border-b transition-colors', selected ? 'bg-muted/60 shadow-[inset_2px_0_0_var(--primary)]' : 'cursor-pointer hover:bg-muted/40', marked && !selected && 'bg-warning/5 shadow-[inset_2px_0_0_var(--warning)]')}
                  style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
                  onAnimationEnd={onArrivedEnd}
                >
                  <span className="flex w-10 shrink-0 justify-center pt-3">
                    <Checkbox aria-label={`${line.key} 선택`} checked={isPicked} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onPick(Boolean(checked))} />
                  </span>
                    <div className={cn('min-w-0 flex-1 px-3', selected ? 'py-3' : 'py-2.5')}>
                      {/* Who says it above the text; lines nobody says (UI, documents, narration) only name their kind. */}
                      <p className="mb-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        {/* Status and speaker are metadata; all tags share the translation-side row. */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex shrink-0">
                              <StatusDot color={status?.color ?? '#a1a1aa'} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{status?.name}</TooltipContent>
                        </Tooltip>
                        {line.speaker ? (
                          <SpeakerCard projectId={projectId} name={line.speaker}>
                            <span className="truncate">{line.speaker}</span>
                          </SpeakerCard>
                        ) : (
                          <span className="shrink-0 text-muted-foreground/70">{UNSPOKEN[line.kind] ?? '지문'}</span>
                        )}
                        {marked && <span className="shrink-0 text-warning">● {findLabel}</span>}
                        {line.kind === 'dialogue' && !who.unknown && <span className="truncate">→ {who.text}</span>}
                        {selected && <LineLinks projectId={projectId} unitId={line.id} hasNote={!!line.note} onNote={() => onNoting(true)} onDetail={onDetail} />}
                      </p>
                      {selected ? (
                        <LineSourceText projectId={projectId} unitId={line.id} source={line.source} className="text-base" />
                      ) : (
                        <TokenText text={line.source} source={line.source} pattern={tokenPattern} className="text-sm" />
                      )}
                    </div>
                    <div className={cn('min-w-0 flex-1 border-l px-3', selected ? 'py-3' : 'py-2.5')}>
                      {selected ? (
                        <>
                          <TranslationEditor key={`editor-${line.id}`} projectId={projectId} unit={line} statuses={statusList} focusKey={focusTick} marks={tagRow} onEscape={onEscape} onDone={onDone} />
                          <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={onNoting} />
                          <LineHints projectId={projectId} line={line} />
                        </>
                      ) : (
                        <div className="pt-4 text-sm">
                          <div className="min-w-0">
                            {line.translation ? <TokenText text={line.translation} source={line.source} pattern={tokenPattern} /> : <span className="text-muted-foreground/60">—</span>}
                            {tagRow}
                            {review && !!line.lastRun?.issues.length && (
                              <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                                <CircleAlert className="mt-0.5 size-3 shrink-0" />
                                <span className="line-clamp-2">{line.lastRun.issues[0]}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                </li>
                </>
  );
}
