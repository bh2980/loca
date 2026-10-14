/** One row of the line list, with the hints and links that open under the picked line. */
import { useMemo, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from '@tanstack/react-router';
import { Check, CircleAlert, Network, PanelRightOpen, StickyNote } from 'lucide-react';
import { AUTO_MARKS, compileFormatRules, isUnknownListener, listenerLabel, needsListener, type FormatRules, type LineMark, type ListenerOrigin, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { AiMark, MarkChip, StatusDot, TagChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, TokenText } from '@/components/editor/source-text';
import { LineNote } from '@/components/script/line-note';
import { withoutTokens } from '@/lib/line-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { client, unwrap } from '@/lib/api';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { ListenerPicker } from '@/components/script/listener-picker';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { GROUP_KIND } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { SpeakerCard } from '@/components/script/speaker-card';
import type { InferResponseType } from '@/lib/api';

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
 * What to keep in mind while typing a line. `context` is about the source (its speech level, the
 * confirmed terms it uses) and sits under it; `result` is about the draft (format problems, the last
 * run's issue) and sits under the editor; without `part`, both. Links to elsewhere are LineLinks, by the status.
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
    <span key={key} title={title} className={cn('inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs', ok === false && 'border-warning/40 text-warning')}>
      {ok === true && <Check className="size-3 text-success" />}
      {ok === false && <CircleAlert className="size-3" />}
      {label}
    </span>
  );
  const context = [
    ...used.map((term) => hint(term.id, text ? text.toLowerCase().includes(term.target.toLowerCase()) : null, `${term.source} → ${term.target}`)),
  ];
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
    relation && { key: 'relation', label: '관계', text: [relation.kind, relation.description].filter(Boolean).join(' — ') },
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

/** The picked line's listener, changed right in its speaker row (the same picker as the line pane). */
function PickedListener({ projectId, line }: { projectId: string; line: Line }) {
  const unit = useQuery(q.unit(line.id));
  const people = useQuery(q.characters(projectId));
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: (listener: string | null) => unwrap(client.units[':unitId'].$patch({ param: { unitId: line.id }, json: { listener } })),
    onMutate: async (listener) => ({ undo: await optimistic(queryClient, unitChanges([line.id], patchedLine({ listener }))) }),
    onError: (error, _listener, context) => {
      context?.undo();
      toast.error(error.message);
    },
  });
  const cast = (people.data?.characters ?? []).filter((person) => person.status === 'confirmed').map((person) => ({ name: person.name, player: person.player }));
  return <ListenerPicker inline line={{ ...line, sceneNames: unit.data?.sceneNames }} cast={cast} onPick={(listener) => patch.mutate(listener)} />;
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
  const rules = useQuery(q.project(projectId)).data?.formatRules ?? undefined;
  // Narration and lines of format tokens only are said to nobody: no listener slot, unless a person or the import gave one.
  const said = needsListener(line, rules) || (Boolean(line.listener) && (line.listenerOrigin === 'human' || line.listenerOrigin === 'import'));
  const who = listenerText(line, rules);
  const marks: LineMark[] = [];
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
  // Lines nobody says read apart from dialogue without a label on every row: narration is muted
  // (stage directions), a document reads as prose, a UI string is one dense row with its key.
  const narration = line.kind === 'dialogue' && !line.speaker?.trim();
  const sourceClass = narration ? 'text-muted-foreground' : line.kind === 'document' ? 'leading-relaxed' : undefined;
  const header = newScene && (
    <li className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/80 px-4 py-1 text-xs text-muted-foreground backdrop-blur">
      <span className="truncate font-medium text-foreground">{line.groupTitle}</span>
      {onOpenScene && (
        <Button variant="ghost" size="inline" className="ml-auto" onClick={() => onOpenScene(line.groupId, line.id)}>
          {GROUP_KIND[line.groupKind]} 열기
        </Button>
      )}
    </li>
  );
  const checkbox = <Checkbox aria-label={`${line.key} 선택`} checked={isPicked} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onPick(Boolean(checked))} />;
  // A UI string not being edited: key, source and translation on one line, like a string table
  // (not in the review inbox, whose rows show why each line waits there).
  if (line.kind === 'ui' && !selected && !review)
    return (
      <>
        {header}
        <li
          ref={rowRef}
          onClick={onSelect}
          className={cn('grid cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] border-b transition-colors hover:bg-muted/40', marked && 'bg-warning/5 shadow-[inset_2px_0_0_var(--warning)]')}
          style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
          onAnimationEnd={onArrivedEnd}
        >
          <span className="flex justify-center pt-2.5">{checkbox}</span>
          <div className="flex min-w-0 items-baseline gap-3 px-3 py-2">
            <span className="w-32 shrink-0 truncate font-mono text-xs text-muted-foreground" title={line.key}>
              {line.key}
            </span>
            <TokenText text={line.source} source={line.source} pattern={tokenPattern} className="min-w-0 text-sm" />
          </div>
          <div className="flex min-w-0 items-baseline gap-2 border-l px-3 py-2 text-sm">
            {/* Empty when untranslated: the status beside it already says so. */}
            <span className="min-w-0 flex-1">{line.translation && <TokenText text={line.translation} source={line.source} pattern={tokenPattern} />}</span>
            {tagRow}
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <StatusDot color={status?.color ?? '#a1a1aa'} />
              {status?.name}
              <AiMark by={line.statusBy} />
            </span>
          </div>
        </li>
      </>
    );
  return (
                <>
                {header}
                {/*
                  Checkbox · source · translation over three rows. Row 1 is metadata in words: who says
                  it to whom over the source, the translation's status over the translation. Row 2 is the
                  text, both columns starting at the same height. Row 3 is the line's tags (every #chip,
                  in one place) under the translation, where they stay while editing (under the input).
                  The source column holds context only: under the picked source, its speech rule, terms, note.
                */}
                <li
                  ref={rowRef}
                  onClick={() => !selected && onSelect()}
                  className={cn('grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] border-b transition-colors', selected ? 'bg-muted/60 shadow-[inset_2px_0_0_var(--primary)]' : 'cursor-pointer hover:bg-muted/40', marked && !selected && 'bg-warning/5 shadow-[inset_2px_0_0_var(--warning)]')}
                  style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
                  onAnimationEnd={onArrivedEnd}
                >
                  {/* Who says it (a UI string: its key). An unknown listener is said here, by the speaker, and filters like the #청자 미상 tag would. */}
                  <p className="col-start-2 flex min-w-0 items-center gap-1 px-3 pt-3.5 pb-1.5 text-xs text-muted-foreground">
                    {line.speaker ? (
                      <SpeakerCard projectId={projectId} name={line.speaker}>
                        <span className="truncate">{line.speaker}</span>
                      </SpeakerCard>
                    ) : (
                      // A UI string is named by its key; narration and documents need no name.
                      line.kind === 'ui' && <span className="truncate font-mono">{line.key}</span>
                    )}
                    {said &&
                      (selected ? (
                        <PickedListener projectId={projectId} line={line} />
                      ) : who.unknown ? (
                        <Button variant="ghost" size="inline" className="h-auto shrink-0 p-0 text-xs font-normal text-warning hover:bg-transparent" title={`#${AUTO_MARKS.unknownListener.name} 줄만 보기`} onClick={(event) => (event.stopPropagation(), onFilterMark('unknownListener'))}>
                          → {who.text}
                        </Button>
                      ) : (
                        <SpeakerCard projectId={projectId} name={line.listener}>
                          <span className="truncate">→ {who.text}</span>
                        </SpeakerCard>
                      ))}
                    {marked && <span className="shrink-0 text-warning">● {findLabel}</span>}
                  </p>
                  {/* The translation's status (✦ when a run set it), and the picked line's links. */}
                  <p className="flex min-w-0 items-center gap-1 border-l px-3 pt-3.5 pb-1.5 text-xs text-muted-foreground">
                    <StatusDot color={status?.color ?? '#a1a1aa'} />
                    <span className="truncate">{status?.name}</span>
                    <AiMark by={line.statusBy} />
                    {selected && <LineLinks projectId={projectId} unitId={line.id} hasNote={!!line.note} onNote={() => onNoting(true)} onDetail={onDetail} />}
                  </p>
                  <span className={cn('col-start-1 row-start-2 flex justify-center pt-1', selected || !tagRow ? 'pb-3.5' : '')}>
                    {checkbox}
                  </span>
                  <div className={cn('row-start-2 min-w-0 px-3', selected || !tagRow ? 'pb-3.5' : '')}>
                    {/* The same size picked or not, so picking a line never rewraps its source. */}
                    {selected ? (
                      <>
                        <LineSourceText projectId={projectId} unitId={line.id} source={line.source} translation={line.translation} className={cn('text-base', sourceClass)} />
                        <LineHints projectId={projectId} line={line} part="context" />
                        <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={onNoting} />
                      </>
                    ) : (
                      <TokenText text={line.source} source={line.source} pattern={tokenPattern} className={cn('text-base', sourceClass)} />
                    )}
                  </div>
                  <div className={cn('row-start-2 min-w-0 border-l px-3', selected || !tagRow ? 'pb-3.5' : '')}>
                    {selected ? (
                      <>
                        <TranslationEditor key={`editor-${line.id}`} projectId={projectId} unit={line} statuses={statusList} focusKey={focusTick} marks={tagRow} onEscape={onEscape} onDone={onDone} />
                        <LineHints projectId={projectId} line={line} part="result" />
                      </>
                    ) : (
                      <div className="text-base">
                        {line.translation ? <TokenText text={line.translation} source={line.source} pattern={tokenPattern} /> : <span className="text-muted-foreground/60">미번역</span>}
                        {review && !!line.lastRun?.issues.length && (
                          <p className="mt-1 flex items-start gap-1 text-xs text-warning">
                            <CircleAlert className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-2">{line.lastRun.issues[0]}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {!selected && tagRow && <div className="col-start-3 row-start-3 min-w-0 border-l px-3 pt-1 pb-3.5">{tagRow}</div>}
                </li>
                </>
  );
}
