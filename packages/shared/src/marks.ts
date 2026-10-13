import { z } from 'zod';

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
  remaining: { name: '남은 줄', on: ['lines'], color: '#3b82f6', description: '최종 상태가 아닌 대사' },
  ai: { name: 'AI가 정함', on: ['lines', 'knowledge', 'terms'], color: '#8b5cf6', description: 'AI가 정하고 아직 사람이 확인하지 않음 (✦)' },
  unknownListener: { name: '청자 미상', on: ['lines'], color: '#f59e0b', description: '청자를 모르거나 AI의 추정이 불확실한 대사' },
  diverged: { name: '같은 원문 다른 번역', on: ['lines'], color: '#ef4444', description: '같은 원문이 다른 곳에서 다르게 번역됨' },
  noted: { name: '메모', on: ['lines'], color: '#14b8a6', description: '줄 메모가 있음' },
  candidate: { name: '후보', on: ['knowledge', 'terms'], color: '#ec4899', description: '아직 번역 문맥에 쓰이지 않음' },
  noEvidence: { name: '근거 없음', on: ['knowledge'], color: '#f59e0b', description: '근거 대사가 없음' },
  emptyTarget: { name: '번역어 없음', on: ['terms'], color: '#ef4444', description: '한국어 번역어가 비어 있음' },
  unused: { name: '대본에 안 나옴', on: ['terms'], color: '#a1a1aa', description: '원문에 나오는 대사가 없음' },
} as const satisfies Record<string, { name: string; on: readonly TagScope[]; color: string; description: string }>;
export type AutoMark = keyof typeof AUTO_MARKS;
export const AUTO_MARK_IDS = Object.keys(AUTO_MARKS) as AutoMark[];

/** The project's own colors for automatic marks; a mark not listed keeps its default. */
export const markColorsSchema = z.partialRecord(z.enum(AUTO_MARK_IDS as [AutoMark, ...AutoMark[]]), z.string().regex(/^#[0-9a-f]{6}$/i));
export type MarkColors = z.infer<typeof markColorsSchema>;

export const markColor = (mark: AutoMark, colors?: MarkColors | null) => colors?.[mark] ?? AUTO_MARKS[mark].color;

/** The marks that apply to lines (what the line filter, run scope and workflow conditions offer). */
export type LineMark = { [K in AutoMark]: 'lines' extends (typeof AUTO_MARKS)[K]['on'][number] ? K : never }[AutoMark];
export const LINE_MARK_IDS = AUTO_MARK_IDS.filter((id): id is LineMark => (AUTO_MARKS[id].on as readonly string[]).includes('lines'));
