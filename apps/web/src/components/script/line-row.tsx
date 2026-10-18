/** One row of the line list, with the hints and links that open under the picked line. */
import { useMemo, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert } from 'lucide-react';
import { AUTO_MARKS, compileFormatRules, isUnknownListener, listenerLabel, needsListener, type FormatRules, type LineMark, type ListenerOrigin, mentions, SPEECH_LEVEL_LABELS, speechLevelOf } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { TranslationEditor } from '@/components/translation-editor';
import { LineSourceText, TokenText } from '@/components/editor/source-text';
import { LineNote } from '@/components/script/line-note';
import { withoutTokens } from '@/lib/line-context';
import { Button, Checkbox, AiMark, StatusIcon, TagChip, SpeakerIdentity, TranslationRow, SceneSectionHeader, type StatusLike } from '@loca/ui';
import { client } from '@/lib/api';
import { q } from '@/lib/queries';
import { GROUP_KIND } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { SpeakerCard } from '@/components/script/speaker-card';
import { useDraft } from '@/lib/drafts';
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

type LineTag = StatusLike & { role?: string | null };
type Line = InferResponseType<(typeof client.projects)[':projectId']['units']['$get']> extends { rows: (infer Row)[] } ? Row : never;

/** One line of the list: a compact row, or the open editor when picked. */
export function LineRow({ projectId, line, newScene, selected, marked, findLabel, status, statusList, tags, tokenPattern, review, display = 'grid', isPicked, arrived, rowRef, noting, focusTick, onPick, onSelect, onOpenScene, onArrivedEnd, onNoting, onEscape, onDone, onFilterTag, onFilterMark }: {
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
  display?: 'grid' | 'focus' | 'review';
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
    <li className="group/scene border-t border-border-subtle bg-background select-none">
      <SceneSectionHeader
        title={line.groupTitle}
        trailing={onOpenScene && <Button variant="ghost" size="inline" onClick={() => onOpenScene(line.groupId, line.id)}>{GROUP_KIND[line.groupKind]} 열기</Button>}
      />
    </li>
  );
  const checkbox = <Checkbox aria-label={`${line.key} 선택`} checked={isPicked} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => onPick(Boolean(checked))} />;
  const speaker = line.kind === 'ui' ? (
    <span className="truncate font-mono text-xs text-muted-foreground" title={line.key}>{line.key}</span>
  ) : line.speaker ? (
    <SpeakerCard projectId={projectId} name={line.speaker}><SpeakerIdentity speaker={line.speaker} listener={said ? who.text : undefined} /></SpeakerCard>
  ) : null;
  const identity = (
    <div className="flex min-w-0 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
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
  const source = selected ? (
    <>
      <LineSourceText projectId={projectId} unitId={line.id} source={line.source} translation={line.translation} className={cn('text-base leading-6', sourceClass)} />
      <LineNote key={`note-${line.id}`} unitId={line.id} note={line.note} editing={noting} onEditing={onNoting} />
    </>
  ) : <TokenText text={line.source} source={line.source} pattern={tokenPattern} className={cn(sourceClass)} />;
  const translation = selected ? (
    <>
      <TranslationEditor key={`editor-${line.id}`} projectId={projectId} unit={line} statuses={statusList} focusKey={focusTick} marks={tagRow} onEscape={onEscape} onDone={onDone} />
      {review && !!line.lastRun?.issues.length && <ReviewIssue issue={line.lastRun.issues[0]} />}
    </>
  ) : (
    <>
      {line.translation ? <TokenText text={line.translation} source={line.source} pattern={tokenPattern} /> : <span className="text-xs text-muted-foreground">번역 없음</span>}
      {review && !!line.lastRun?.issues.length && <ReviewIssue issue={line.lastRun.issues[0]} />}
      {tagRow}
    </>
  );
  const compact = line.kind === 'ui' && !selected && !review && display === 'grid';
  const row = (
    <TranslationRow
      checkbox={checkbox}
      speaker={identity}
      status={statusContent}
      meta={aiMeta}
      source={source}
      translation={translation}
      selected={selected}
      compact={compact}
      layout={display}
      className={cn(selected ? 'bg-selection' : 'cursor-pointer hover:bg-accent', marked && !selected && 'bg-warning/5')}
    />
  );
  return (
    <>
      {header}
      <li
        ref={rowRef}
        onClick={() => !selected && onSelect()}
        className={cn('transition-colors', selected ? 'bg-selection' : 'cursor-pointer', marked && !selected && 'bg-warning/5')}
        style={arrived ? { animation: 'line-arrived 2s ease-out' } : undefined}
        onAnimationEnd={onArrivedEnd}
      >
        {row}
      </li>
    </>
  );
}

function ReviewIssue({ issue }: { issue: string }) {
  return <p className="mt-1 flex items-start gap-1 text-xs text-warning"><CircleAlert className="mt-0.5 size-3 shrink-0" /><span className="line-clamp-2">{issue}</span></p>;
}
