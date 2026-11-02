import { ChangedElsewhere } from './changed-elsewhere';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, Check, CircleAlert, ClipboardPaste, Languages, MoreHorizontal, Save, Sparkles, Undo2, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { checkFormat, listenerLabel, SPEECH_LEVEL_LABELS, speechLevelOf, type FormatIssue, type FormatRules, withSourceWhitespace } from '@tw/shared';
import { TokenChip, TokenText } from '@/components/editor/source-text';
import { AiSuggestion } from '@/components/ai-suggestion';
import { focusEndOfLine, insertUnitIntoLine, proposeInLine, replaceLineText, TranslationInput } from '@/components/editor/translation-input';
import { Chip, Box, Button, Icon, Inline, Text, AiMark, EditorAction, EditorChangedWord, EditorDraftNote, EditorSuggestionList, EditorSuggestionRow, DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuContent } from '@loca/ui';
import { apiFetch } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { wordDiff } from '@/lib/diff';
import { placeTags } from '@/lib/tag-placement';
import { editorChecks, useLineContext } from '@/lib/line-context';
import type { TokenUnit } from '@/lib/tokens';
import { useSaveLine } from '@/lib/line-save';
import { offerSameSource } from '@/lib/same-source';
import { q } from '@/lib/queries';
import { lineContext, useLineDetail } from '@/lib/units';
import { keyLabel } from '@/lib/keys';
import { useProject } from '@/lib/project';

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
 * an AI 제안 waiting on the line shows under it with 적용 · 거절, and translations of the same or a similar source
 * elsewhere (TM) sit below (the first three always shown), ⌥⇧1…⌥⇧3 to take one into the box.
 */
export function TranslationEditor({
  projectId,
  unit,
  statuses,
  onDone,
  onEscape,
  focusKey,
  marks,
  compact,
}: {
  projectId: string;
  unit: { id: string; source: string; kind?: string; translation: string | null; statusId: string; statusBy?: 'ai' | 'human' };
  statuses: Status[];
  onDone?: (moved: boolean) => void;
  onEscape?: () => void;
  /** Changing this to a non-zero number puts the cursor at the end of the text. */
  focusKey?: number;
  /** List rows supply their single shared tag row directly below the input. */
  marks?: ReactNode;
  /** A card with little room (the graph's): no TM under the box (the line's detail has it). An AI 제안 still shows. */
  compact?: boolean;
}) {
  // The body only: the source's leading and trailing whitespace goes around it when it is saved.
  const saved = (unit.translation ?? '').trim();
  const [draft, setDraft, clearDraft, base] = useDraft(`line:${unit.id}`, saved);
  const dirty = draft !== saved;
  // Settling a collision gives the box its focus back, so ⌘S works without another click.
  const [refocus, setRefocus] = useState(0);
  const next = nextStatus(statuses, unit.statusId);
  const line = useLineContext(projectId, unit.source, unit.kind);
  // The line's detail carries its AI 제안 (list rows do not).
  const detail = useLineDetail(projectId, unit.id);
  const suggestions = useSuggestions(unit.id, [saved, draft], !compact);
  // The AI continuation: asked once when the line opens empty, or with ⌥/.
  const project = useProject(projectId);
  const editorAi = project.data?.editorAi;
  // Each button has its own model (설정 › 에디터); the continuation only when it is on with a model.
  // AI 번역 and 다듬기 share one model.
  const hasModel = Boolean(editorAi?.model.model);
  const completes = Boolean(editorAi?.complete.enabled && editorAi.complete.model);
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
  const delayMs = editorAi?.complete.delayMs ?? 500;
  useEffect(() => {
    // Asked by itself once the line has stayed open a moment (lines passed with ↑↓ are not asked); it does
    // not take the focus. Alt+/ asks at once.
    const timer = completes && !draft.trim() && !continuations.has(unit.id) ? setTimeout(() => ask('', false), delayMs) : undefined;
    return () => {
      clearTimeout(timer);
      pending.current?.abort();
    };
  }, [unit.id, completes]); // eslint-disable-line react-hooks/exhaustive-deps
  // AI 번역 / 다듬기: waited for, then a new AI candidate of the line (the text itself does not change).
  const [assist, setAssist] = useState<{ loading?: 'translate' | 'refine'; done?: 'translate' | 'refine' | 'unchanged'; message?: string; from?: string; text?: string; reasons?: string[] }>({});
  const assistPending = useRef<AbortController>(null);
  const runAssist = (mode: 'translate' | 'refine') => {
    if (assist.loading || !hasModel || (mode === 'refine' && !draft.trim())) return;
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

  // Missing format units the rules can place.
  const tags = useMemo(() => placeTags(unit.source, draft, line.tokenPattern, line.terms), [unit.source, draft, line.tokenPattern, line.terms]);
  const placeMissing = () => tags.inserts.length > 0 && proposeInLine(unit.id, tags.inserts);

  const queryClient = useQueryClient();
  const save = useSaveLine(projectId);
  // Everything sent is what was typed when saving began: typing goes on while it is on its way.
  const run = (advance: boolean) => {
    if (save.isPending) return;
    const sent = draft;
    if (advance && (next || (dirty && statuses.find((status) => status.id === unit.statusId)?.kind === 'final')) && !sent.trim()) {
      toast.error('번역을 입력한 뒤 확정하세요.');
      return;
    }
    if (dirty && base !== saved) {
      toast.error('다른 곳에서 바뀐 번역을 확인하고 어느 내용을 유지할지 선택하세요.');
      return;
    }
    const changed = dirty;
    const statusId = advance && next ? next.id : undefined;
    if (!changed && !statusId) return onDone?.(advance);
    save.mutate(
      { unitId: unit.id, ...(changed && { text: sent, base }), statusId },
      {
        onSuccess: () => {
          // Only the draft that was sent: anything typed after it stays a draft.
          clearDraft(sent);
          if (changed && sent.trim()) void offerSame(sent);
          if (advance && next) toast.success(`${changed ? '저장하고 ' : ''}‘${next.name}’(으)로 옮겼습니다.`);
          onDone?.(advance);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const offerSame = (text: string) => offerSameSource(queryClient, unit.id, text);

  const requestAssist = (mode: 'translate' | 'refine') => {
    if (project.isPending) {
      toast.info('편집기 AI 설정을 확인하고 있습니다.');
      return;
    }
    // No model in 설정 › 에디터: the buttons are not shown, and their shortcut does nothing.
    if (!hasModel) return;
    if (mode === 'refine' && !draft.trim()) {
      toast.info('다듬을 번역이 없습니다.');
      return;
    }
    runAssist(mode);
  };
  /** Another line's translation is text to adapt: it goes into the box (⌘Z takes it back). */
  const takeSuggestion = (suggestion: Suggestion) => replaceLineText(unit.id, suggestion.text) || setDraft(suggestion.text);
  const putSource = () => replaceLineText(unit.id, unit.source) || setDraft(unit.source);

  return (
    <Box spaceY="condensed" onClick={(event) => event.stopPropagation()}>
      {dirty && base !== saved && <ChangedElsewhere fields={['번역']} onTakeSaved={() => (clearDraft(), setRefocus((tick) => tick + 1))} onKeepMine={() => { clearDraft(); setDraft(draft); setRefocus((tick) => tick + 1); }} />}
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
        onPick={compact ? undefined : (index) => suggestions[index] && takeSuggestion(suggestions[index])}
        onPlaceTags={placeMissing}
        continuation={continuation}
        onAssist={() => requestAssist(draft.trim() ? 'refine' : 'translate')}
        onContinue={completes ? () => ask(draft) : undefined}
        continuing={ai.loading}
        onDismissContinuation={() => (pending.current?.abort(), setAi((state) => ({ ...state, loading: false, dismissed: true })))}
        focusKey={(focusKey ?? 0) + refocus}
      />
      {marks}
      {/* What 다듬기 changed in the box and why, while the box still holds its answer. */}
      {assist.done === 'refine' && assist.text === draft && assist.from !== undefined && (
        <Box spaceY="hair" radius="md" border="all" background="page" paddingX="condensed" paddingY="condensed" variant="body">
          <Text as="p" breakWords preserveLines>
            {wordDiff(assist.from, assist.text).map((part, index) => (
              // Tokens stay chips inside the marked words.
              <TokenText key={index} text={part.text} source={unit.source} pattern={line.tokenPattern} look={part.change ?? 'plain'} />
            ))}
          </Text>
          {assist.reasons?.map((reason) => (
            <Text as="p" key={reason} variant="caption" tone="muted">
              {reason}
            </Text>
          ))}
          <Button variant="ghost" size="inline" tone="muted" title={keyLabel('Mod+Z')} onClick={() => replaceLineText(unit.id, assist.from!) || setDraft(assist.from!)}>
            원래대로
          </Button>
        </Box>
      )}
      <DraftChecks unitId={unit.id} source={unit.source} draft={draft} units={line.units} terms={line.terms} tags={tags} rules={project.data?.formatRules ?? undefined} targetLanguage={project.data?.targetLanguage} onPlace={placeMissing} />
      <Inline wrap gap="condensed" paddingTop="tight">
        {dirty && <EditorDraftNote>저장 안 한 수정 · 이 브라우저에 보관됨</EditorDraftNote>}
        {save.isPending && <Text variant="caption" tone="muted" aria-live="polite">저장 중…</Text>}
        {marks === undefined && !dirty && unit.statusBy === 'ai' && (
          <Inline as="span" gap="tight" variant="caption" tone="muted">
            <AiMark by="ai" /> AI 초안
          </Inline>
        )}
        <Inline gap="condensed" minWidth={0} shrink={false}>
          {next ? <EditorAction icon={Check} disabled={save.isPending} disabledReason={!draft.trim() && '번역이 비어 있습니다. 번역을 쓴 뒤 넘길 수 있습니다.'} onClick={() => run(true)} title={keyLabel('Mod+Enter')}>
            {next.name}{onDone ? '하고 다음' : '하기'}
          </EditorAction> : onDone ? <EditorAction icon={ArrowDown} disabled={save.isPending} disabledReason={dirty && !draft.trim() && statuses.find((status) => status.id === unit.statusId)?.kind === 'final' && '완료 상태인 줄의 번역은 비울 수 없습니다.'} onClick={() => run(true)} title={keyLabel('Mod+Enter')}>
            {dirty ? '저장하고 다음 줄' : '다음 줄'}
          </EditorAction> : dirty ? <EditorAction icon={Save} disabled={save.isPending} onClick={() => run(false)} title={keyLabel('Mod+S')}>
            저장
          </EditorAction> : null}
          {hasModel && <>
            <EditorAction icon={Languages} variant="ghost" disabled={!!assist.loading} onClick={() => requestAssist('translate')}>
              {draft.trim() ? 'AI 다시' : 'AI 번역'}
            </EditorAction>
            <EditorAction icon={WandSparkles} variant="ghost" disabled={!!assist.loading} disabledReason={!draft.trim() && '다듬을 번역이 없습니다.'} onClick={() => requestAssist('refine')} title={keyLabel('Alt+.')}>
              다듬기
            </EditorAction>
          </>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="번역 동작 더보기"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" width="fit">
              {dirty && <>
                <DropdownMenuItem disabled={save.isPending} onSelect={() => run(false)}><Save /> 저장만 <Text marginLeft="auto" variant="caption" tone="muted">{keyLabel('Mod+S')}</Text></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => clearDraft()}><Undo2 /> 되돌리기</DropdownMenuItem>
              </>}
              {dirty && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={putSource}><ClipboardPaste /> 원문 넣기 <Text marginLeft="auto" variant="caption" tone="muted">{keyLabel('Mod+Shift+S')}</Text></DropdownMenuItem>
              {completes && <DropdownMenuItem disabled={!!ai.loading} onSelect={() => ask(draft)}><Sparkles /> AI 자동완성 <Text marginLeft="auto" variant="caption" tone="muted">{keyLabel('Alt+/')}</Text></DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </Inline>
      </Inline>
      {(assist.loading || assist.done === 'unchanged' || assist.message || ai.loading || ai.message) && <Inline wrap gap="condensed" variant="caption" tone="muted" aria-live="polite">
        {assist.loading && <Waiting label={assist.loading === 'refine' ? '다듬는 중…' : 'AI 번역 중…'} onCancel={() => (assistPending.current?.abort(), setAssist({}))} />}
        {assist.done === 'unchanged' && <span>다듬을 곳이 없습니다</span>}
        {assist.message && <span role="alert">{assist.message}</span>}
        {ai.loading && <Waiting label="자동완성 받는 중…" onCancel={() => (pending.current?.abort(), setAi({ dismissed: true }))} />}
        {ai.message && <span role="alert">{ai.message}</span>}
      </Inline>}
      {detail.data && <AiSuggestion projectId={projectId} unit={detail.data} draft={draft} dirty={dirty} base={base} onDraft={setDraft} />}
      {suggestions.length > 0 && (
        <SuggestionList
          suggestions={suggestions}
          source={unit.source}
          tokenPattern={line.tokenPattern}
          onPick={takeSuggestion}
        />
      )}
    </Box>
  );
}

const VISIBLE_SUGGESTIONS = 3;

/**
 * Translations of the same or similar sources (TM), always under the box: the first three
 * with their ⌥⇧1…3 keys, the rest one click away. A similar source shows the words that differ.
 */
function SuggestionList({ suggestions, source, tokenPattern, onPick }: { suggestions: Suggestion[]; source: string; tokenPattern: RegExp | null; onPick: (suggestion: Suggestion) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const more = suggestions.length - VISIBLE_SUGGESTIONS;
  return (
    <EditorSuggestionList label="비슷한 번역" onMore={more > 0 ? () => setAll((open) => !open) : undefined} moreLabel={all ? '접기' : `+${more}개 더보기`}>
        {shown.map((suggestion, index) => (
          <li key={suggestion.key}>
            <EditorSuggestionRow hint={keyLabel(`Alt+Shift+${index + 1}`)} hintHidden={index >= VISIBLE_SUGGESTIONS} onPick={() => onPick(suggestion)}>
              {/* The label stays on its own line: beside the text it would squeeze a narrow column down to a letter per line. */}
              <Box asChild maxWidth="full" truncate><Chip variant="outline">{suggestion.label}</Chip></Box>
              <TokenText text={suggestion.text} source={source} pattern={tokenPattern} look="suggestion" />
              {suggestion.detail && <Text as="p" truncate variant="caption" tone="muted">{suggestion.detail}</Text>}
              {suggestion.diff && (
                <Text as="p" variant="caption" tone="muted">
                  <Text tone="subtle" marginRight="tight">원문 차이</Text>
                  {suggestion.diff.map((word, at) => (
                    <EditorChangedWord key={at} changed={word.changed}>
                      {at > 0 && ' '}
                      {word.text}
                    </EditorChangedWord>
                  ))}
                </Text>
              )}
            </EditorSuggestionRow>
          </li>
        ))}
    </EditorSuggestionList>
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
 * What the translator might adapt instead of typing (TM): translations of the same source elsewhere (who says it to whom,
 * as the speech level may differ), then similar sources with the words that differ marked. Texts already in the box or
 * saved are left out. The line's own earlier texts are in its 이력, an AI's new one in its AI 제안.
 */
function useSuggestions(unitId: string, shown: string[], enabled = true): Suggestion[] {
  const matches = useQuery({ ...q.lineMatches(unitId), enabled });
  const all: Suggestion[] = !enabled ? [] : [
    ...(matches.data ?? []).map((match) => ({
      key: `m:${match.unitId}`,
      text: match.translation,
      label: match.score === 100 ? `같은 원문${match.final ? '' : ' · 미확정'}` : `비슷한 줄 ${match.score}%${match.final ? '' : ' · 미확정'}`,
      detail: [match.speaker, match.listener && `→ ${listenerLabel(match.listener)}`].filter(Boolean).join(' ') || match.groupTitle,
      diff: match.diff,
    })),
  ];
  const seen = new Set(shown.map((text) => text.trim()).filter(Boolean));
  return all.filter((suggestion) => !seen.has(suggestion.text.trim()) && (seen.add(suggestion.text.trim()), true)).slice(0, 9);
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
    <Inline as="span" gap="tight" variant="caption" tone="muted" tabular>
      {label}{seconds > 0 && ` ${seconds}초`}
      <Button variant="ghost" size="inline" tone="muted" onClick={onCancel} title="취소 (Esc)">
        취소
      </Button>
    </Inline>
  );
}


const CHECK_LABELS: Partial<Record<FormatIssue['code'], string>> = { number: '숫자', space: '공백', newline: '줄바꿈', particle: '조사', placeholder: '서식', tag: '서식' };

/**
 * The draft's format checks, short: each missing token as its chip (click puts
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
  const unit = useQuery(lineContext(unitId));
  if (!draft.trim()) return null;
  // Terms and speech are shown by their rule under the source too; here they count toward the one verdict.
  const lower = draft.toLowerCase();
  const unusedTerms = terms.filter((term) => !lower.includes(term.target.toLowerCase()));
  const speech = unit.data?.speech;
  const guessed = speechLevelOf(draft.trim());
  const speechOff = !!speech && speech.level !== 'other' && !!guessed && guessed !== speech.level;
  const missing = units.filter((unit) => tags.placed.includes(unit.number) || tags.left.includes(unit.number));
  // Missing tokens are shown as chips; the tag/placeholder sentence is only needed when nothing is missing (an extra or broken token).
  const issues = checkFormat(source, withSourceWhitespace(source, draft), editorChecks(targetLanguage), rules).filter((issue) => issue.code !== 'empty' && !(missing.length && (issue.code === 'tag' || issue.code === 'placeholder')));
  if (!missing.length && !issues.length && !unusedTerms.length && !speechOff)
    return null;
  return (
    <Inline wrap gap="tight" variant="caption" tone="warning" onClick={(event) => event.stopPropagation()}>
      {missing.length > 0 && <Icon icon={CircleAlert} size="xs" aria-label="빠진 서식" />}
      {missing.map((unit) => (
        <TokenChip
          key={unit.number}
          part={{ text: unit.close ? `${unit.open}…${unit.close}` : unit.open, token: { number: unit.number, kind: 'single' } }}
          missing
          hint={`번역에 없음 · ${keyLabel(`Alt+${unit.number}`)}`}
          onPick={() => insertUnitIntoLine(unitId, unit)}
        />
      ))}
      {tags.placed.length > 0 && (
        <Button variant="ghost" size="inline" tone="muted" title={keyLabel('Alt+T')} onClick={onPlace}>
          제자리에 넣기
        </Button>
      )}
      {unusedTerms.length > 0 && (
        <Inline as="span" inline gap="tight" title={`번역에 없는 용어: ${unusedTerms.map((term) => `${term.source} → ${term.target}`).join(', ')}`}>
          <Icon icon={CircleAlert} size="xs" />용어 {unusedTerms.length}
        </Inline>
      )}
      {speechOff && (
        <Inline as="span" inline gap="tight" title={`말투 규칙은 ${SPEECH_LEVEL_LABELS[speech!.level]}, 지금 번역은 ${SPEECH_LEVEL_LABELS[guessed!]}`}>
          <Icon icon={CircleAlert} size="xs" />말투
        </Inline>
      )}
      {issues.map((issue) => (
        <Inline as="span" inline gap="tight" key={issue.code} title={issue.message}>
          <Icon icon={CircleAlert} size="xs" />
          {CHECK_LABELS[issue.code] ?? issue.code}
        </Inline>
      ))}
    </Inline>
  );
}
