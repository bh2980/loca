import { z } from 'zod';
import { hasText, termText, type FormatRules } from './format-check.ts';
import { aiDecided, isUnsureListener, type KnowledgeStatus, type ListenerOrigin, type StatusBy } from './knowledge.ts';

/** Where a tag can be put and is offered: lines (대사), glossary terms (용어집), knowledge items (자료: people/documents/events). */
export const TAG_SCOPES = ['lines', 'terms', 'knowledge', 'people', 'documents', 'events'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];
export const TAG_SCOPE_LABELS: Record<TagScope, string> = {
  lines: '대사',
  terms: '용어집',
  knowledge: '자료',
  people: '인물·관계',
  documents: '노트',
  events: '사건',
};

/** Normalizes stored or legacy tag scopes ('knowledge' -> 'people', 'documents', 'events'). */
export function normalizeTagScopes(raw: readonly string[] | undefined): TagScope[] {
  const out = new Set<TagScope>();
  for (const item of raw ?? []) {
    if (item === 'knowledge') {
      out.add('people');
      out.add('documents');
      out.add('events');
    } else if ((TAG_SCOPES as readonly string[]).includes(item)) {
      out.add(item as TagScope);
    }
  }
  return TAG_SCOPES.filter((scope) => out.has(scope));
}

/**
 * Automatic tags: facts the app reads off a line, a knowledge item or a term that no column of the
 * row shows (never stored on them, so never stale), shown and filtered like tags, each in its own colour.
 * What a row already shows (its status, who decided it, its listener, its memo, 번역 제외, an empty
 * translation) is a filter on that, not a mark (LineFacts, decidedBy, emptyTarget).
 * `on` says where each one applies.
 */
export const AUTO_MARKS = {
  review: { name: '확인 권장', on: ['people', 'documents', 'events'], color: '#c46016', description: '분석이 사람의 확인이 필요하다고 본 자료(이유는 마우스를 올리면 보임). 사람이 확인함·버리기·고치기로 정하면 떨어짐' },
  diverged: { name: '번역 불일치', on: ['lines'], color: '#d24c49', description: '같은 원문이 다른 곳에서 다르게 번역됨' },
  aiSuggestion: { name: 'AI 제안 대기', on: ['lines'], color: '#2b7bd3', description: 'AI가 낸 번역 제안이 적용·거절을 기다림 (사람이 번역한 줄에 실행이 낸 번역, 채팅·터미널의 번역 제안)' },
  noEvidence: { name: '근거 부재', on: ['people', 'documents', 'events'], color: '#c46016', description: '근거 대사가 없음' },
  unused: { name: '대본 미등장', on: ['terms'], color: '#79818c', description: '원문이나 화자에 나오는 대사가 없음' },
  duplicateTarget: { name: '번역어 중복', on: ['terms'], color: '#c46016', description: '원문이 다른 용어와 번역어가 같음 (막지는 않음: 같은 말로 옮기는 게 맞을 수도 있음)' },
} as const satisfies Record<string, { name: string; on: readonly TagScope[]; color: string; description: string }>;
export type AutoMark = keyof typeof AUTO_MARKS;
export const AUTO_MARK_IDS = Object.keys(AUTO_MARKS) as AutoMark[];

/**
 * The project's own name and colour for an automatic tag (설정 › 상태·태그); what is not set keeps the default. Its 설명,
 * where it goes and what it means are the app's: it is computed, not put on.
 */
export const markStylesSchema = z.partialRecord(
  z.enum(AUTO_MARK_IDS as [AutoMark, ...AutoMark[]]),
  z.object({ name: z.string().trim().min(1).max(40).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }),
);
export type MarkStyles = z.infer<typeof markStylesSchema>;
export const markName = (mark: AutoMark, styles?: MarkStyles | null) => styles?.[mark]?.name ?? AUTO_MARKS[mark].name;
export const markColor = (mark: AutoMark, styles?: MarkStyles | null) => styles?.[mark]?.color ?? AUTO_MARKS[mark].color;

/** The marks that apply to `scope`. */
export const marksOn = (scope: TagScope | 'knowledge'): AutoMark[] => {
  const normalized = scope === 'knowledge' ? 'people' : scope;
  return AUTO_MARK_IDS.filter((id) => (AUTO_MARKS[id].on as readonly string[]).includes(normalized));
};
export const KNOWLEDGE_MARK_IDS = marksOn('people');
export const TERM_MARK_IDS = marksOn('terms');

/** The marks that apply to lines (what the line filter, run scope and workflow conditions offer). */
export type LineMark = { [K in AutoMark]: 'lines' extends (typeof AUTO_MARKS)[K]['on'][number] ? K : never }[AutoMark];
export const LINE_MARK_IDS = AUTO_MARK_IDS.filter((id): id is LineMark => (AUTO_MARKS[id].on as readonly string[]).includes('lines'));
export const lineMarksSchema = z.array(z.enum(LINE_MARK_IDS as [LineMark, ...LineMark[]]));

/** The line marks read off the line itself (lineMarksOf: what workflow conditions can test). 같은 원문 다른 번역 compares across lines, so only the list filter and run scope know it. */
export const CONDITION_MARK_IDS = LINE_MARK_IDS.filter((id) => id !== 'diverged');

/** 정한 쪽: who decided an item — the AI (✦, not checked by a person yet) or a person. A filter on lines, terms and knowledge. */
export const DECIDED_BY = ['ai', 'human'] as const;
export type DecidedBy = (typeof DECIDED_BY)[number];
export const DECIDED_BY_LABELS: Record<DecidedBy, string> = { ai: 'AI', human: '사람' };
/**
 * Whether a line's status, or a term's or knowledge item's decision, was made by `by`. A line's status always
 * has a maker; a candidate term or item is decided by nobody yet, so it matches neither.
 */
export const decidedBy = (item: { status?: string; statusBy: StatusBy }, by: DecidedBy, line = false) =>
  line ? item.statusBy === by : by === 'ai' ? aiDecided(item) : item.statusBy === 'human' && item.status !== 'candidate' && item.status !== 'rejected';

/** 번역 제외 in a line filter: those lines left out (hide), only them (only); absent = with the rest. */
export const EXCLUDED_FILTERS = ['hide', 'only'] as const;
export type ExcludedFilter = (typeof EXCLUDED_FILTERS)[number];

/**
 * What a line filter, a run scope and the CLI can ask of a line besides statuses, tags and marks:
 * the facts its row shows. One shape everywhere (lineFilterSchema, runScopeSchema, the list route).
 */
export const lineFactsShape = {
  /** Lines whose status is not final (true: 최종 아님, the work left; 번역 제외 lines are not work) or final (false). */
  unfinished: z.boolean().optional(),
  /** Who set the line's status (정한 쪽): the AI (✦) or a person. */
  decidedBy: z.enum(DECIDED_BY).optional(),
  /** Lines with a memo (true) or without (false). */
  noted: z.boolean().optional(),
};
export type LineFacts = { unfinished?: boolean; decidedBy?: DecidedBy; noted?: boolean };

/** Whether an item carrying `has` carries every one of the `picked` marks. */
export function matchesMarks(has: readonly AutoMark[], picked: readonly AutoMark[] | undefined) {
  if (!picked?.length) return true;
  return picked.every((mark) => has.includes(mark));
}

/** "확인 안 함": a knowledge item or term no person has decided yet — a candidate, or decided by AI. The run dialog, home and links all count this. */
export const isUnreviewed = (item: { status: KnowledgeStatus; statusBy: StatusBy }) => item.status !== 'rejected' && (item.status === 'candidate' || aiDecided(item));

/**
 * What a line is when the script tells lines apart: the stored kind, with dialogue nobody says (no
 * speaker) read as narration. Not stored: narration is dialogue without a speaker.
 */
export type LineKind = 'dialogue' | 'narration' | 'ui' | 'document';
export const lineKindOf = (line: { kind: string; speaker: string | null }): LineKind =>
  line.kind === 'ui' ? 'ui' : line.kind === 'document' ? 'document' : line.speaker?.trim() ? 'dialogue' : 'narration';

type ListenerLine = { kind: string; speaker: string | null; source: string; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null };

/**
 * A line that is said to someone: dialogue with a speaker and something to say once the project's
 * format tokens are out (`rules`, 설정 › 서식). Narration (no speaker) and lines of only tags or
 * placeholders have no listener. The SQL in line-marks.ts calls this very function (needs_listener).
 */
export const needsListener = (line: Pick<ListenerLine, 'kind' | 'speaker' | 'source'>, rules: FormatRules | undefined) =>
  line.kind === 'dialogue' && Boolean(line.speaker?.trim()) && hasText(line.source, rules);

/** A line that needs a listener whose listener is unknown or an unsure guess. Mirrors the unknownListener SQL on the server. */
export const isUnknownListener = (line: ListenerLine, rules: FormatRules | undefined) => needsListener(line, rules) && (!line.listener || isUnsureListener(line));

/** The marks a line carries, for its row chips and workflow conditions (the SQL in line-marks.ts selects by the same rules). */
export function lineMarksOf(line: { /** It has an AI 제안 waiting (candidates in state pending). */ suggested?: boolean }): LineMark[] {
  return line.suggested ? ['aiSuggestion'] : [];
}

/** The marks a knowledge item carries. */
export function knowledgeMarksOf(item: { status: KnowledgeStatus; statusBy: StatusBy; evidence?: readonly unknown[]; /** Why the analysis wants a person to look (확인 권장); empty when none. */ reviewNote?: string }): AutoMark[] {
  return [Boolean(item.reviewNote) && 'review', item.evidence !== undefined && item.evidence.length === 0 && 'noEvidence'].filter((mark): mark is AutoMark => Boolean(mark));
}

/** The marks a glossary term carries. `duplicateTarget` comes from the whole glossary (withDuplicateTargets). */
export function termMarksOf(term: { lines: number | null; duplicateTarget?: boolean }): AutoMark[] {
  return [term.lines === 0 && 'unused', term.duplicateTarget && 'duplicateTarget'].filter((mark): mark is AutoMark => Boolean(mark));
}

/**
 * A term's Korean forms after `next` becomes the main one (`target`, the one used): the former main
 * goes to the front of the candidates, and `next` leaves them. Like a line's candidates, nothing is lost.
 */
export function withMainTarget(term: { target: string; targetCandidates: readonly string[] }, next: string): { target: string; targetCandidates: string[] } {
  const target = termText(next);
  const former = termText(term.target);
  return { target, targetCandidates: [...new Set([...(former && former !== target ? [former] : []), ...term.targetCandidates])].filter((form) => form && form !== target) };
}

/** A term's candidates with `form` offered (an AI's form while the main one stays): unchanged when it is the main one or already there. */
export function withTargetCandidate(term: { target: string; targetCandidates: readonly string[] }, form: string): string[] {
  const offered = termText(form);
  if (!offered || offered === termText(term.target) || term.targetCandidates.includes(offered)) return [...term.targetCandidates];
  return [offered, ...term.targetCandidates];
}

/**
 * The terms with `duplicateTarget`: another term of a different source (case aside) that is not
 * rejected has the same Korean form (Ava and Joy both 조이). Only a mark: two sources may rightly
 * share a translation, and a project that confirms AI terms right away chose that.
 */
export function withDuplicateTargets<T extends { source: string; target: string; status: KnowledgeStatus }>(terms: T[]): (T & { duplicateTarget: boolean })[] {
  const key = (text: string) => text.trim().toLowerCase();
  const sources = new Map<string, Set<string>>();
  for (const term of terms) if (term.status !== 'rejected' && key(term.target)) sources.set(key(term.target), (sources.get(key(term.target)) ?? new Set()).add(key(term.source)));
  return terms.map((term) => ({ ...term, duplicateTarget: term.status !== 'rejected' && (sources.get(key(term.target))?.size ?? 0) > 1 }));
}

/** The `marks` URL param: a list of mark ids (also accepts one id or a comma list), unknown ids dropped. */
export function parseMarks<T extends AutoMark = AutoMark>(raw: unknown, allowed: readonly T[] = AUTO_MARK_IDS as unknown as readonly T[]): T[] | undefined {
  const values = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []).filter((value): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value));
  return values.length ? [...new Set(values)] : undefined;
}
