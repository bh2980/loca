import { z } from 'zod';
import { hasText, type FormatRules } from './format-check.ts';
import { aiDecided, isUnsureListener, type KnowledgeStatus, type ListenerOrigin, type StatusBy } from './knowledge.ts';

/** Where a tag can be put and is offered: lines (대사), knowledge items (자료), glossary terms (용어집). */
export const TAG_SCOPES = ['lines', 'knowledge', 'terms'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];
export const TAG_SCOPE_LABELS: Record<TagScope, string> = { lines: '대사', knowledge: '자료', terms: '용어집' };

/**
 * Automatic marks: facts the app reads off a line, a knowledge item or a term (never stored on
 * them, so never stale), shown and filtered like tags. They are the project's built-in tags: listed
 * in 상태·태그, not deletable or renamable, with a color the project can change (markColors).
 * `on` says where each one applies.
 */
export const AUTO_MARKS = {
  remaining: { name: '남은 줄', on: ['lines'], color: '#0486d3', description: '최종 상태가 아닌 대사' },
  ai: { name: 'AI가 정함', on: ['lines', 'knowledge', 'terms'], color: '#8f68cb', description: 'AI가 정하고 아직 사람이 확인하지 않음 (✦)' },
  unknownListener: { name: '청자 미상', on: ['lines'], color: '#c46016', description: '화자가 있는 대사 중 청자를 모르거나 AI의 추정이 불확실한 대사(지문·서식만 있는 줄 제외)' },
  diverged: { name: '같은 원문 다른 번역', on: ['lines'], color: '#d24c49', description: '같은 원문이 다른 곳에서 다르게 번역됨' },
  noted: { name: '메모', on: ['lines'], color: '#009589', description: '줄 메모가 있음' },
  candidate: { name: '후보', on: ['knowledge', 'terms'], color: '#bc5694', description: '아직 번역 문맥에 쓰이지 않음' },
  noEvidence: { name: '근거 없음', on: ['knowledge'], color: '#c46016', description: '근거 대사가 없음' },
  emptyTarget: { name: '번역어 없음', on: ['terms'], color: '#d24c49', description: '한국어 번역어가 비어 있음' },
  unused: { name: '대본에 안 나옴', on: ['terms'], color: '#79818c', description: '원문이나 화자에 나오는 대사가 없음' },
} as const satisfies Record<string, { name: string; on: readonly TagScope[]; color: string; description: string }>;
export type AutoMark = keyof typeof AUTO_MARKS;
export const AUTO_MARK_IDS = Object.keys(AUTO_MARKS) as AutoMark[];

/** The project's own colors for automatic marks; a mark not listed keeps its default. */
export const markColorsSchema = z.partialRecord(z.enum(AUTO_MARK_IDS as [AutoMark, ...AutoMark[]]), z.string().regex(/^#[0-9a-f]{6}$/i));
export type MarkColors = z.infer<typeof markColorsSchema>;

export const markColor = (mark: AutoMark, colors?: MarkColors | null) => colors?.[mark] ?? AUTO_MARKS[mark].color;

/** The marks that apply to `scope`. */
export const marksOn = (scope: TagScope): AutoMark[] => AUTO_MARK_IDS.filter((id) => (AUTO_MARKS[id].on as readonly string[]).includes(scope));
export const KNOWLEDGE_MARK_IDS = marksOn('knowledge');
export const TERM_MARK_IDS = marksOn('terms');

/** The marks that apply to lines (what the line filter, run scope and workflow conditions offer). */
export type LineMark = { [K in AutoMark]: 'lines' extends (typeof AUTO_MARKS)[K]['on'][number] ? K : never }[AutoMark];
export const LINE_MARK_IDS = AUTO_MARK_IDS.filter((id): id is LineMark => (AUTO_MARKS[id].on as readonly string[]).includes('lines'));
export const lineMarksSchema = z.array(z.enum(LINE_MARK_IDS as [LineMark, ...LineMark[]]));

/** The line marks read off the line itself (lineMarksOf: what workflow conditions can test). 같은 원문 다른 번역 compares across lines, so only the list filter and run scope know it. */
export const CONDITION_MARK_IDS = LINE_MARK_IDS.filter((id) => id !== 'diverged');

/**
 * Marks that are values of one field: a knowledge item or a term is either a candidate or decided
 * by AI, never both. Picked together they mean either one; marks of different groups (or none) must
 * all hold. This is the one place filters, links and counts take the rule from.
 */
export const MARK_GROUPS: Partial<Record<AutoMark, 'decision'>> = { candidate: 'decision', ai: 'decision' };

/** Whether an item carrying `has` passes a filter of `picked` marks (see MARK_GROUPS). */
export function matchesMarks(has: readonly AutoMark[], picked: readonly AutoMark[] | undefined) {
  if (!picked?.length) return true;
  const groups = new Map<string, AutoMark[]>();
  for (const mark of picked) {
    const group = MARK_GROUPS[mark] ?? mark;
    groups.set(group, [...(groups.get(group) ?? []), mark]);
  }
  return [...groups.values()].every((anyOf) => anyOf.some((mark) => has.includes(mark)));
}

/** "확인 안 함": a knowledge item or term no person has decided yet — a candidate, or decided by AI. The run dialog, home and links all count this. */
export const UNREVIEWED_MARKS = ['candidate', 'ai'] as const satisfies readonly AutoMark[];
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
export function lineMarksOf(line: ListenerLine & { statusBy: StatusBy; note: string }, final: boolean, rules: FormatRules | undefined): LineMark[] {
  return [!final && 'remaining', line.statusBy === 'ai' && 'ai', isUnknownListener(line, rules) && 'unknownListener', line.note.trim() !== '' && 'noted'].filter((mark): mark is LineMark => Boolean(mark));
}

/** The marks a knowledge item carries. */
export function knowledgeMarksOf(item: { status: KnowledgeStatus; statusBy: StatusBy; evidence?: readonly unknown[] }): AutoMark[] {
  return [item.status === 'candidate' && 'candidate', aiDecided(item) && 'ai', item.evidence !== undefined && item.evidence.length === 0 && 'noEvidence'].filter((mark): mark is AutoMark => Boolean(mark));
}

/** The marks a glossary term carries. */
export function termMarksOf(term: { status: KnowledgeStatus; statusBy: StatusBy; target: string; lines: number | null }): AutoMark[] {
  return [term.status === 'candidate' && 'candidate', aiDecided(term) && 'ai', !term.target.trim() && 'emptyTarget', term.lines === 0 && 'unused'].filter((mark): mark is AutoMark => Boolean(mark));
}

/** The `marks` URL param: a list of mark ids (also accepts one id or a comma list), unknown ids dropped. */
export function parseMarks<T extends AutoMark = AutoMark>(raw: unknown, allowed: readonly T[] = AUTO_MARK_IDS as unknown as readonly T[]): T[] | undefined {
  const values = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []).filter((value): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value));
  return values.length ? [...new Set(values)] : undefined;
}
