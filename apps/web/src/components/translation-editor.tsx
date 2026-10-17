import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CircleAlert, Languages, Sparkles, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { checkFormat, listenerLabel, SPEECH_LEVEL_LABELS, speechLevelOf, type FormatIssue, type FormatRules } from '@tw/shared';
import { TokenChip, TokenText } from '@/components/editor/source-text';
import { focusEndOfLine, insertUnitIntoLine, proposeInLine, replaceLineText, TranslationInput } from '@/components/editor/translation-input';
import { AiMark, StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import { apiFetch, client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { wordDiff } from '@/lib/diff';
import { placeTags } from '@/lib/tag-placement';
import { editorChecks, useLineContext } from '@/lib/line-context';
import type { TokenUnit } from '@/lib/tokens';
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
 * sessionStorage until saved, shared with the line pane's checks. Format tokens are chips (⌃⌥1…9
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
  marks,
  className,
}: {
  projectId: string;
  unit: { id: string; source: string; translation: string | null; statusId: string; statusBy?: 'ai' | 'human'; candidates?: { id: string; text: string }[] };
  statuses: Status[];
  onDone?: (moved: boolean) => void;
  onEscape?: () => void;
  /** Changing this to a non-zero number puts the cursor at the end of the text. */
  focusKey?: number;
  /** List rows supply their single shared tag row directly below the input. */
  marks?: ReactNode;
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
  // The AI continuation (docs/DESIGN.md J3b A): asked once when the line opens empty, or with ⌥/.
  const project = useQuery(q.project(projectId));
  const editorAi = project.data?.editorAi;
  const [ai, setAi] = useState<{ text?: string; loading?: boolean; message?: string; dismissed?: boolean }>(() => ({ text: continuations.get(unit.id) }));
  const pending = useRef<AbortController>(null);
  const ask = (prefix: string, focus = true) => {
    pending.current?.abort();
    const controller = (pending.current = new AbortController());
    setAi({ loading: true });
    void apiFetch(`/api/units/${unit.id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefix }), signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { text?: string; error?: string; retryAfterSeconds?: number };
        if (!response.ok || !body.text) {
          const wait = body.retryAfterSeconds ? ` · ${body.retryAfterSeconds >= 3600 ? `${Math.ceil(body.retryAfterSeconds / 3600)}시간` : `${Math.max(1, Math.ceil(body.retryAfterSeconds / 60))}분`} 뒤` : '';
          setAi({ message: `${body.error ?? '자동완성을 받지 못했습니다.'}${wait}` });
          return;
        }
        // The line should start with what was typed; a model that sent only the rest gets it put after.
        const text = body.text.startsWith(prefix) ? body.text : `${prefix}${prefix && !/\s$/.test(prefix) ? ' ' : ''}${body.text}`;
        continuations.set(unit.id, text);
        setAi({ text });
        // The continuation shows at the end of the text, so the cursor goes there (the button took the focus).
        if (focus) requestAnimationFrame(() => focusEndOfLine(unit.id));
      })
      .catch((error: unknown) => !controller.signal.aborted && setAi({ message: error instanceof Error ? error.message : String(error) }));
  };
  useEffect(() => {
    // Asked by itself when the line opens: it does not take the focus (↑↓ may still be moving through lines).
    if (editorAi?.enabled && editorAi.model && !draft.trim() && !continuations.has(unit.id)) ask('', false);
    return () => pending.current?.abort();
  }, [unit.id, editorAi?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // AI 번역 / 다듬기 (docs/DESIGN.md J3b C): waited for, then a new AI candidate of the line (the text itself does not change).
  const [assist, setAssist] = useState<{ loading?: 'translate' | 'refine'; done?: 'translate' | 'refine' | 'unchanged'; message?: string; from?: string; text?: string; reasons?: string[] }>({});
  const assistPending = useRef<AbortController>(null);
  const runAssist = (mode: 'translate' | 'refine') => {
    if (assist.loading || !editorAi?.assistModel || (mode === 'refine' && !draft.trim())) return;
    assistPending.current?.abort();
    const controller = (assistPending.current = new AbortController());
    const sent = draft;
    setAssist({ loading: mode });
    void apiFetch(`/api/units/${unit.id}/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode, draft: mode === 'refine' ? draft : '' }), signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { text?: string; reasons?: string[]; unchanged?: boolean; error?: string; retryAfterSeconds?: number };
        if (response.ok && body.unchanged) return setAssist({ done: 'unchanged' });
        if (!response.ok || !body.text) {
          const wait = body.retryAfterSeconds ? ` · ${body.retryAfterSeconds >= 3600 ? `${Math.ceil(body.retryAfterSeconds / 3600)}시간` : `${Math.max(1, Math.ceil(body.retryAfterSeconds / 60))}분`} 뒤` : '';
          setAssist({ message: `${body.error ?? 'AI 응답을 받지 못했습니다.'}${wait}` });
          return;
        }
        // The answer goes into the box (as CAT tools insert a result); ⌘Z or 원래대로 brings the old text back. It stays a candidate too.
        if (!replaceLineText(unit.id, body.text)) setDraft(body.text);
        setAssist({ done: mode, from: sent, text: body.text, reasons: body.reasons });
      })
      .catch((error: unknown) => !controller.signal.aborted && setAssist({ message: error instanceof Error ? error.message : String(error) }));
  };
  useEffect(() => {
    setAssist({});
    return () => assistPending.current?.abort();
  }, [unit.id]);
  // What is shown: the rest of the AI's line after what is typed (while it still matches), up to the end of the next sentence.
  const continuation = ai.text && !ai.dismissed && ai.text.startsWith(draft) ? nextSentence(ai.text.slice(draft.length)) : '';

  // Missing format units the rules can place (docs/DESIGN.md J3b B).
  const tags = useMemo(() => placeTags(unit.source, draft, line.tokenPattern, line.terms), [unit.source, draft, line.tokenPattern, line.terms]);
  const placeMissing = () => tags.inserts.length > 0 && proposeInLine(unit.id, tags.inserts);

  const queryClient = useQueryClient();
  const save = useMutation({
    // Everything sent is what was typed when saving began (text, changed): typing goes on while it is on its way.
    mutationFn: ({ advance, text: sent, changed }: { advance: boolean; text: string; changed: boolean }) => {
      // Saving the exact text of an existing candidate selects it instead of duplicating it.
      const same = candidates.find((candidate) => candidate.text === sent);
      const text = changed ? (same ? { candidateId: same.id } : { translation: sent }) : {};
      const statusId = advance && next ? { statusId: next.id } : {};
      if (!Object.keys(text).length && !Object.keys(statusId).length) return Promise.resolve(null);
      return unwrap(client.units[':unitId'].$patch({ param: { unitId: unit.id }, json: { ...text, ...statusId } }));
    },
    // The saved text and next status show at once, so the old translation never flashes back.
    onMutate: async ({ advance, text: sent, changed }) => {
      const same = candidates.find((candidate) => candidate.text === sent);
      const change = { ...(changed && { translation: same ? same.text : sent }), ...(advance && next && { statusId: next.id }) };
      return { undo: Object.keys(change).length ? await optimistic(queryClient, unitChanges([unit.id], patchedLine(change))) : undefined };
    },
    onSuccess: (_data, { advance, text, changed }) => {
      // Only the draft that was sent: anything typed after it stays a draft.
      clearDraft(text);
      // What was saved, taken when it was sent (the optimistic update has already made it the translation).
      if (changed && text.trim()) void offerSameSource(text);
      if (advance && next) toast.success(`${changed ? '저장하고 ' : ''}‘${next.name}’(으)로 옮겼습니다.`);
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
        onPick={(index) => suggestions[index] && (replaceLineText(unit.id, suggestions[index].text) || setDraft(suggestions[index].text))}
        onPlaceTags={placeMissing}
        continuation={continuation}
        onAssist={() => runAssist(draft.trim() ? 'refine' : 'translate')}
        onContinue={editorAi?.enabled ? () => ask(draft) : undefined}
        continuing={ai.loading}
        onDismissContinuation={() => (pending.current?.abort(), setAi((state) => ({ ...state, loading: false, dismissed: true })))}
        focusKey={focusKey}
        placeholder="번역을 입력하세요. 저장하면 번역 칸에 바로 들어갑니다."
      />
      {marks}
      {/* What 다듬기 changed in the box and why, while the box still holds its answer. */}
      {assist.done === 'refine' && assist.text === draft && assist.from !== undefined && (
        <div className="space-y-0.5 rounded-md border bg-background px-2 py-1.5 text-xs">
          <p className="break-words whitespace-pre-wrap">
            {wordDiff(assist.from, assist.text).map((part, index) => (
              // Tokens stay chips inside the marked words.
              <TokenText key={index} text={part.text} source={unit.source} pattern={line.tokenPattern} className={cn('inline', part.change === 'removed' && 'text-destructive line-through decoration-destructive/60', part.change === 'added' && 'rounded-sm bg-success/15 text-success')} />
            ))}
          </p>
          {assist.reasons?.map((reason) => (
            <p key={reason} className="text-muted-foreground">
              {reason}
            </p>
          ))}
          <Button variant="ghost" size="inline" className="text-muted-foreground" title={`다듬기 전 글로 (${keyLabel('Mod+Z')})`} onClick={() => replaceLineText(unit.id, assist.from!) || setDraft(assist.from!)}>
            원래대로
          </Button>
        </div>
      )}
      <DraftChecks unitId={unit.id} source={unit.source} draft={draft} units={line.units} terms={line.terms} tags={tags} rules={project.data?.formatRules ?? undefined} targetLanguage={project.data?.targetLanguage} onPlace={placeMissing} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {dirty && <span className="text-xs font-medium text-warning">저장 안 됨</span>}
        {editorAi?.enabled && editorAi.model && !ai.loading && (
          <Button variant="ghost" size="inline" className="text-xs text-muted-foreground hover:text-foreground" title={`이어질 번역 보기 (${keyLabel('Alt+/')}, Tab으로 받기)`} onClick={() => ask(draft)}>
            <Sparkles className="size-3.5 text-accent-indigo" /> AI 자동완성
          </Button>
        )}
        {editorAi?.assistModel ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              disabled={!!assist.loading}
              title={`원문에서 새로 번역${draft.trim() ? '' : ` (${keyLabel('Alt+.')})`}`}
              onClick={() => runAssist('translate')}
            >
              <Languages className="size-3.5 text-accent-indigo" />
              <span>AI 번역</span>
            </Button>
            <Button
              variant="outline"
              disabled={!!assist.loading || !draft.trim()}
              title={draft.trim() ? `틀린 곳만 고치기 (${keyLabel('Alt+.')})` : '다듬을 번역이 없습니다'}
              onClick={() => runAssist('refine')}
            >
              <WandSparkles className="size-3.5 text-accent-indigo" />
              <span>다듬기</span>
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="inline" className="text-xs text-muted-foreground hover:text-foreground" asChild>
            <Link to="/p/$projectId/ai/usage" params={{ projectId }} title="AI › 사용 방식에서 AI 번역·다듬기 모델을 고르면 쓸 수 있습니다">
              <Sparkles className="size-3.5 text-muted-foreground" /> AI 번역 모델 설정
            </Link>
          </Button>
        )}
        {assist.loading && <Waiting label={assist.loading === 'refine' ? '다듬는 중…' : 'AI 번역 중…'} onCancel={() => (assistPending.current?.abort(), setAssist({}))} />}
        {assist.done === 'unchanged' && <span className="text-xs text-muted-foreground">다듬을 곳이 없습니다</span>}
        {assist.message && <span className="text-xs text-muted-foreground">{assist.message}</span>}
        {ai.loading && <Waiting label="자동완성 받는 중…" onCancel={() => (pending.current?.abort(), setAi({ dismissed: true }))} />}
        {ai.message && <span className="text-xs text-muted-foreground">{ai.message}</span>}
        {marks === undefined && !dirty && unit.statusBy === 'ai' && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AiMark by="ai" /> AI가 정함
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => clearDraft()}>
              되돌리기
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => run(false)}
            title={`저장 (${keyLabel('Mod+S')})`}
          >
            저장
          </Button>
          {next && (
            <Button
              variant="default"
              disabled={save.isPending}
              onClick={() => run(true)}
              title={`${dirty ? '저장하고 ' : ''}‘${next.name}’(으)로 옮기고 다음 줄 (${keyLabel('Mod+Enter')})`}
            >
              <StatusDot color={next.color} className="size-1.5" />
              <span>{next.name}</span>
            </Button>
          )}
        </div>
      </div>
      {!dirty && <PreviousDiff unitId={unit.id} openAtFirst={unit.statusBy === 'ai'} />}
      {suggestions.length > 0 && (
        <div className="mt-2.5 overflow-hidden rounded-md border border-border/80 bg-surface-1/30">
          <div className="border-b border-border-subtle bg-surface-1/60 px-3 py-1.5 text-xs font-medium text-muted-foreground select-none">
            유사 번역 및 후보
          </div>
          <ol className="divide-y divide-border-subtle">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.key}>
                <Button
                  variant="ghost"
                  size="row"
                  className="group flex h-auto w-full items-start gap-3 rounded-none px-3 py-2 text-left hover:bg-surface-2"
                  title={`번역 칸에 넣기 (${keyLabel(`Alt+Shift+${index + 1}`)})`}
                  onClick={() => replaceLineText(unit.id, suggestion.text) || setDraft(suggestion.text)}
                >
                  <kbd className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded border border-border/80 bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground group-hover:border-accent-indigo/40 group-hover:text-foreground select-none">
                    {keyLabel(`Alt+Shift+${index + 1}`)}
                  </kbd>
                  <div className="min-w-0 flex-1 space-y-1">
                    <TokenText text={suggestion.text} source={unit.source} pattern={line.tokenPattern} className="block text-sm font-medium leading-relaxed text-foreground" />
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{suggestion.label}</span>
                      {suggestion.detail && <span>· {suggestion.detail}</span>}
                      {suggestion.reasons?.map((reason) => (
                        <span key={reason}>· {reason}</span>
                      ))}
                    </div>
                    {suggestion.diff && (
                      <div className="text-xs text-muted-foreground">
                        {suggestion.diff.map((word, at) => (
                          <span key={at} className={cn(word.changed && 'rounded-xs bg-warning/15 px-0.5 text-warning font-medium')}>
                            {at > 0 && ' '}
                            {word.text}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Button>
              </li>
            ))}
          </ol>
        </div>
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
  /** 다듬기: why it changed what it did. */
  reasons?: string[];
}

/** A 다듬기 candidate's note: '다듬기 — <kind> · <why> — …'. */
const refineReasons = (note: string) => (note.startsWith('다듬기') ? note.split(' — ').slice(1) : null);

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
    ...(unit.data?.candidates ?? []).map((candidate) => {
      const reasons = candidate.origin === 'ai' ? refineReasons(candidate.note) : null;
      if (reasons) return { key: `c:${candidate.id}`, text: candidate.text, label: 'AI 다듬기', detail: candidate.model ?? undefined, reasons };
      return { key: `c:${candidate.id}`, text: candidate.text, label: origin[candidate.origin], detail: [candidate.note, candidate.model].filter(Boolean).join(' · ') || undefined };
    }),
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

/** The AI's line per line, kept while the page is open so going back to a line does not ask again. */
const continuations = new Map<string, string>();

/** Up to the end of the next sentence (its punctuation and closing quote included). */
function nextSentence(rest: string) {
  const match = /^\s*[\s\S]*?[.!?…。]+["'”’)\]]*(?=\s|$)/u.exec(rest);
  return match ? match[0] : rest;
}

/** "자동완성 받는 중… 4초" (or another label) with a way out (Esc in the box does the same). */
function Waiting({ label, onCancel }: { label: string; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
      {label}{seconds > 0 && ` ${seconds}초`}
      <Button variant="ghost" size="inline" className="text-muted-foreground" onClick={onCancel} title="취소 (Esc)">
        취소
      </Button>
    </span>
  );
}


const CHECK_LABELS: Partial<Record<FormatIssue['code'], string>> = { number: '숫자', space: '공백', newline: '줄바꿈', particle: '조사', placeholder: '서식', tag: '서식' };

/**
 * The draft's format checks (docs/DESIGN.md J3), short: each missing token as its chip (click puts
 * it at the cursor; the same chips are ringed in the source), one icon and word per other problem
 * (the full sentence in its tooltip), or a quiet ✓ when all pass.
 */
function DraftChecks({ unitId, source, draft, units, terms, tags, rules, targetLanguage, onPlace }: {
  unitId: string;
  source: string;
  draft: string;
  units: TokenUnit[];
  /** Confirmed terms the source uses (the chips under the source). */
  terms: { source: string; target: string }[];
  tags: ReturnType<typeof placeTags>;
  rules?: FormatRules;
  targetLanguage?: string;
  onPlace: () => void;
}) {
  const unit = useQuery(q.unit(unitId));
  if (!draft.trim()) return null;
  // Terms and speech are shown by their rule under the source too; here they count toward the one verdict.
  const lower = draft.toLowerCase();
  const unusedTerms = terms.filter((term) => !lower.includes(term.target.toLowerCase()));
  const speech = unit.data?.speech;
  const guessed = speechLevelOf(draft.trim());
  const speechOff = !!speech && speech.level !== 'other' && !!guessed && guessed !== speech.level;
  const missing = units.filter((unit) => tags.placed.includes(unit.number) || tags.left.includes(unit.number));
  // Missing tokens are shown as chips; the tag/placeholder sentence is only needed when nothing is missing (an extra or broken token).
  const issues = checkFormat(source, draft, editorChecks(targetLanguage), rules).filter((issue) => issue.code !== 'empty' && !(missing.length && (issue.code === 'tag' || issue.code === 'placeholder')));
  if (!missing.length && !issues.length && !unusedTerms.length && !speechOff)
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground" title="용어 · 말투 · 서식 · 숫자 · 공백 · 줄바꿈 · 조사 검사 통과">
        <Check className="size-3 text-success" /> 검사 통과
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-warning" onClick={(event) => event.stopPropagation()}>
      {missing.length > 0 && <CircleAlert className="size-3" aria-label="빠진 서식" />}
      {missing.map((unit) => (
        <TokenChip
          key={unit.number}
          part={{ text: unit.close ? `${unit.open}…${unit.close}` : unit.open, token: { number: unit.number, kind: 'single' } }}
          missing
          hint={`번역에 없음 · 눌러서 넣기 (${keyLabel(`Alt+${unit.number}`)})`}
          onPick={() => insertUnitIntoLine(unitId, unit)}
        />
      ))}
      {tags.placed.length > 0 && (
        <Button variant="ghost" size="inline" className="text-xs text-muted-foreground" title={`자리를 찾은 ${tags.placed.length}개 넣기 (${keyLabel('Alt+T')}, Tab으로 받기)`} onClick={onPlace}>
          제자리에 넣기
        </Button>
      )}
      {unusedTerms.length > 0 && (
        <span className="inline-flex items-center gap-1" title={`번역에 없는 용어: ${unusedTerms.map((term) => `${term.source} → ${term.target}`).join(', ')}`}>
          <CircleAlert className="size-3" />용어 {unusedTerms.length}
        </span>
      )}
      {speechOff && (
        <span className="inline-flex items-center gap-1" title={`말투 규칙은 ${SPEECH_LEVEL_LABELS[speech!.level]}, 지금 번역은 ${SPEECH_LEVEL_LABELS[guessed!]}`}>
          <CircleAlert className="size-3" />말투
        </span>
      )}
      {issues.map((issue) => (
        <span key={issue.code} className="inline-flex items-center gap-1" title={issue.message}>
          <CircleAlert className="size-3" />
          {CHECK_LABELS[issue.code] ?? issue.code}
        </span>
      ))}
    </div>
  );
}
