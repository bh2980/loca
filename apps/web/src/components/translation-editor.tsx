import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listenerLabel } from '@tw/shared';
import { TokenText } from '@/components/editor/source-text';
import { proposeInLine, TranslationInput } from '@/components/editor/translation-input';
import { AiMark, StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { wordDiff } from '@/lib/diff';
import { placeTags } from '@/lib/tag-placement';
import { useLineContext } from '@/lib/line-context';
import { optimistic, patchedLine, unitChanges } from '@/lib/optimistic';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/lib/keys';

interface Status {
  id: string;
  name: string;
  color: string;
  kind: 'initial' | 'normal' | 'final';
}

/** The status ⌘↵ moves a line to: the first final status, unless the line is already final. */
export function nextStatus(statuses: Status[], currentId: string) {
  const current = statuses.find((status) => status.id === currentId);
  if (current?.kind === 'final') return undefined;
  return statuses.find((status) => status.kind === 'final');
}

/**
 * The translation editor of one line. ⌘S saves the text as a person's candidate and makes it the
 * translation; ⌘↵ saves (if changed) and moves the line to the next status, then `onDone` lets
 * the list go to the next line; Esc leaves the editor (the draft stays). The text is a draft in
 * sessionStorage until saved, shared with the line pane's checks. Format tokens are chips (⌘1…⌘9
 * insert the source's), glossary translations are offered while typing, ⌘⇧S copies the source,
 * and suggestions (other candidates, the same or a similar source translated elsewhere) sit
 * under the box, ⌥1…⌥3 to take one.
 */
export function TranslationEditor({
  projectId,
  unit,
  statuses,
  onDone,
  onEscape,
  focusKey,
  className,
}: {
  projectId: string;
  unit: { id: string; source: string; translation: string | null; statusId: string; statusBy?: 'ai' | 'human'; candidates?: { id: string; text: string }[] };
  statuses: Status[];
  onDone?: (moved: boolean) => void;
  onEscape?: () => void;
  /** Changing this to a non-zero number puts the cursor at the end of the text. */
  focusKey?: number;
  className?: string;
}) {
  const [draft, setDraft, clearDraft] = useDraft(`line:${unit.id}`, unit.translation ?? '');
  const dirty = draft !== (unit.translation ?? '');
  const next = nextStatus(statuses, unit.statusId);
  const line = useLineContext(projectId, unit.source);
  // The line's candidates: list rows do not carry them, the line's detail does (shared with the suggestions).
  const detail = useQuery(q.unit(unit.id));
  const candidates = unit.candidates ?? detail.data?.candidates ?? [];
  const suggestions = useSuggestions(unit.id, [unit.translation ?? '', draft]);
  // Missing format units the rules can place (docs/DESIGN.md J3b B).
  const tags = useMemo(() => placeTags(unit.source, draft, line.tokenPattern, line.terms), [unit.source, draft, line.tokenPattern, line.terms]);
  const placeMissing = () => tags.inserts.length > 0 && proposeInLine(unit.id, tags.inserts);

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: ({ advance }: { advance: boolean; text: string; changed: boolean }) => {
      // Saving the exact text of an existing candidate selects it instead of duplicating it.
      const same = candidates.find((candidate) => candidate.text === draft);
      const text = dirty ? (same ? { candidateId: same.id } : { translation: draft }) : {};
      const statusId = advance && next ? { statusId: next.id } : {};
      if (!Object.keys(text).length && !Object.keys(statusId).length) return Promise.resolve(null);
      return unwrap(client.units[':unitId'].$patch({ param: { unitId: unit.id }, json: { ...text, ...statusId } }));
    },
    // The saved text and next status show at once, so the old translation never flashes back.
    onMutate: async ({ advance }) => {
      const same = candidates.find((candidate) => candidate.text === draft);
      const change = { ...(dirty && { translation: same ? same.text : draft }), ...(advance && next && { statusId: next.id }) };
      return { undo: Object.keys(change).length ? await optimistic(queryClient, unitChanges([unit.id], patchedLine(change))) : undefined };
    },
    onSuccess: (_data, { advance, text, changed }) => {
      clearDraft();
      // What was saved, taken when it was sent (the optimistic update has already made it the translation).
      if (changed && text.trim()) void offerSameSource(text);
      if (advance && next) toast.success(`${dirty ? '저장하고 ' : ''}‘${next.name}’(으)로 옮겼습니다.`);
      onDone?.(advance);
    },
    onError: (error, _vars, context) => {
      context?.undo?.();
      toast.error(error.message);
    },
  });
  const run = (advance: boolean) => !save.isPending && save.mutate({ advance, text: draft, changed: dirty });

  /**
   * After a new translation is saved, other lines with the same source that are not final and say
   * something else are offered the same text (one click, never by itself). Who says it to whom is
   * named, as the speech level may rightly differ.
   */
  const offerSameSource = async (text: string) => {
    const same = await queryClient.fetchQuery({ ...q.sameSource(unit.id), staleTime: 0 }).catch(() => []);
    const others = same.filter((line) => !line.final && (line.translation ?? '').trim() !== text.trim());
    if (!others.length) return;
    const who = [...new Set(others.map((line) => [line.speaker, line.listener && `→ ${listenerLabel(line.listener)}`].filter(Boolean).join(' ')).filter(Boolean))];
    toast(`같은 원문 ${others.length}줄이 ${others.some((line) => line.translation) ? '다르게 번역돼' : '번역 없이'} 있습니다`, {
      description: `${who.slice(0, 3).join(', ')}${who.length > 3 ? ` 외 ${who.length - 3}` : ''}${who.length ? ' · 화자·청자가 다르면 말투가 다를 수 있습니다' : ''}`,
      duration: 10000,
      action: {
        label: '모두 이 번역으로',
        onClick: async () => {
          try {
            for (const line of others) await unwrap(client.units[':unitId'].$patch({ param: { unitId: line.id }, json: { translation: text } }));
            toast.success(`같은 원문 ${others.length}줄에 적용했습니다.`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        },
      },
    });
  };

  return (
    <div className={cn('space-y-2', className)} onClick={(event) => event.stopPropagation()}>
      <TranslationInput
        unitId={unit.id}
        value={draft}
        onChange={setDraft}
        source={unit.source}
        tokenPattern={line.tokenPattern}
        units={line.units}
        terms={line.terms}
        onSave={() => run(false)}
        onAdvance={() => run(true)}
        onEscape={onEscape}
        onPick={(index) => suggestions[index] && setDraft(suggestions[index].text)}
        onPlaceTags={placeMissing}
        focusKey={focusKey}
        placeholder="번역을 입력하세요. 저장하면 사람 후보가 되고 대표 번역이 됩니다."
      />
      <div className="flex flex-wrap items-center gap-2">
        {dirty && <span className="text-xs text-warning">저장 안 됨</span>}
        {/* Format units the source has and the text lacks: placed by rule as ghosts (Tab takes them). */}
        {draft.trim() && tags.placed.length > 0 && (
          <Button variant="ghost" size="inline" className="text-token-1" title={`빠진 서식 넣기 (${keyLabel('Mod+Shift+T')}) · 제자리에 흐리게 보이고 Tab으로 넣음`} onClick={placeMissing}>
            서식 {tags.placed.length}개 넣기
          </Button>
        )}
        {draft.trim() && tags.left.length > 0 && <span className="text-xs text-muted-foreground">서식 {tags.left.length}개는 자리를 못 찾음</span>}
        {!dirty && unit.statusBy === 'ai' && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AiMark by="ai" /> AI가 정함
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={clearDraft}>
              되돌리기
            </Button>
          )}
          <Button variant={next ? 'outline' : 'default'} disabled={!dirty || save.isPending} onClick={() => run(false)} title={`저장 (${keyLabel('Mod+S')})`}>
            저장
          </Button>
          {next && (
            <Button disabled={save.isPending} onClick={() => run(true)} title={`${dirty ? '저장하고 ' : ''}‘${next.name}’(으)로 옮기고 다음 줄 (${keyLabel('Mod+Enter')})`}>
              <StatusDot color={next.color} /> {next.name}
            </Button>
          )}
        </div>
      </div>
      {!dirty && <PreviousDiff unitId={unit.id} openAtFirst={unit.statusBy === 'ai'} />}
      {suggestions.length > 0 && (
        <ol className="divide-y rounded-md border bg-background text-sm">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.key}>
              <Button variant="ghost" size="row" className="h-auto items-start gap-2 rounded-none py-1.5 text-left font-normal" title={`번역 칸에 넣기 (${keyLabel(`Alt+${index + 1}`)})`} onClick={() => setDraft(suggestion.text)}>
                <span className="mt-px w-5 shrink-0 font-mono text-xs text-muted-foreground">{keyLabel(`Alt+${index + 1}`)}</span>
                <span className="min-w-0 flex-1">
                  <TokenText text={suggestion.text} source={unit.source} pattern={line.tokenPattern} className="block" />
                  {/* Where it comes from under the text, so the text keeps the full width. */}
                  <span className="block text-xs text-muted-foreground">
                    {suggestion.label}
                    {suggestion.detail && ` · ${suggestion.detail}`}
                  </span>
                  {suggestion.diff && (
                    <span className="block text-xs text-muted-foreground">
                      {suggestion.diff.map((word, at) => (
                        <span key={at} className={cn(word.changed && 'rounded-sm bg-warning/15 text-warning')}>
                          {at > 0 && ' '}
                          {word.text}
                        </span>
                      ))}
                    </span>
                  )}
                </span>

              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface Suggestion {
  key: string;
  text: string;
  label: string;
  detail?: string;
  diff?: { text: string; changed: boolean }[];
}

/**
 * What the translator might take instead of typing: the line's other candidates (AI, people,
 * imported), then translations of the same source elsewhere (who says it to whom, as the speech
 * level may differ), then similar sources with the words that differ marked. Texts already in
 * the box or saved are left out.
 */
function useSuggestions(unitId: string, shown: string[]): Suggestion[] {
  const unit = useQuery(q.unit(unitId));
  const matches = useQuery(q.lineMatches(unitId));
  const origin = { ai: 'AI 후보', human: '사람 후보', import: '가져온 후보', tool: '채팅 후보' } as const;
  const all: Suggestion[] = [
    ...(unit.data?.candidates ?? []).map((candidate) => ({ key: `c:${candidate.id}`, text: candidate.text, label: origin[candidate.origin], detail: candidate.model ?? undefined })),
    ...(matches.data ?? []).map((match) => ({
      key: `m:${match.unitId}`,
      text: match.translation,
      label: match.score === 100 ? `같은 원문${match.final ? '' : ' · 미확정'}` : `비슷한 줄 ${match.score}%${match.final ? '' : ' · 미확정'}`,
      detail: [match.speaker, match.listener && `→ ${listenerLabel(match.listener)}`].filter(Boolean).join(' ') || match.groupTitle,
      diff: match.diff,
    })),
  ];
  const seen = new Set(shown.map((text) => text.trim()).filter(Boolean));
  return all.filter((suggestion) => !seen.has(suggestion.text.trim()) && (seen.add(suggestion.text.trim()), true)).slice(0, 3);
}

/**
 * What the current translation changed from the one before it (the previous candidate with other
 * text), word by word: removed words struck through, added ones marked. Open from the start when a
 * run set the line (to check what the AI changed); otherwise one click away.
 */
function PreviousDiff({ unitId, openAtFirst }: { unitId: string; openAtFirst: boolean }) {
  const unit = useQuery(q.unit(unitId));
  const [open, setOpen] = useState(openAtFirst);
  const candidates = unit.data?.candidates ?? []; // newest first
  const at = candidates.findIndex((candidate) => candidate.id === unit.data?.candidateId);
  const current = candidates[at];
  const previous = at >= 0 ? candidates.slice(at + 1).find((candidate) => candidate.text.trim() !== current.text.trim()) : undefined;
  if (!current || !previous) return null;
  const origin = { ai: 'AI', human: '사람', import: '가져온 번역', tool: '채팅' } as const;
  if (!open)
    return (
      <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={() => setOpen(true)}>
        이전 번역과 비교
      </Button>
    );
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm">
      <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        이전 번역({origin[previous.origin]})에서 바뀐 곳
        <Button variant="ghost" size="inline" className="ml-auto" onClick={() => setOpen(false)}>
          접기
        </Button>
      </p>
      <p className="break-words whitespace-pre-wrap">
        {wordDiff(previous.text, current.text).map((part, index) => (
          <span key={index} className={cn(part.change === 'removed' && 'text-destructive line-through decoration-destructive/60', part.change === 'added' && 'rounded-sm bg-success/15 text-success')}>
            {part.text}
          </span>
        ))}
      </p>
    </div>
  );
}
