import { normalizeTagScopes, type TagScope } from './marks.ts';
/**
 * The kinds of problem a check or a review names (a review's `categories`, a check's `kind`), and the tag a new project
 * gets for each. The tags are ordinary tags (renamed, recoloured, deleted like any other): a workflow's 태그 붙이기 node
 * says which tag a kind goes on as (its category map), puts it on and takes it off; nothing else does (a new text, a
 * person's save, leaves them: the default workflows take them off after AI 수정). Filters, run scopes and conditions use
 * them, so "말투 문제만 다시 번역" is a filter and a run.
 */
export const ISSUE_KINDS = {
  format: { name: '형식 오류', color: '#c46016', description: '원문의 자리표시자·태그·줄바꿈이 번역에서 빠졌거나 달라짐 (형식 검사, AI 검수)' },
  term: { name: '용어 위반', color: '#b26f00', description: '원문에 나온 확정 용어가 용어집의 번역어대로 쓰이지 않음 (용어 검사, AI 검수)' },
  speech: { name: '말투 어긋남', color: '#bc5694', description: '화자 → 청자 말투 규칙(존댓말·반말, 호칭)과 번역의 말투가 다름 (말투 판정, AI 검수)' },
  meaning: { name: '의미 오류', color: '#d24c49', description: '원문과 뜻이 다름: 오역, 빠뜨린 내용, 원문에 없는 내용 (AI 검수)' },
  style: { name: '문체 어색', color: '#8f68cb', description: '뜻은 맞지만 한국어가 어색하거나 부자연스러움 (AI 검수)' },
  other: { name: '기타 지적', color: '#79818c', description: 'AI 검수가 위 다섯 가지에 들지 않는다고 본 문제' },
  /** Not a finding about the translation: the line's AI step finally failed (set by an extraction workflow's failure branch; a review never names it). */
  aiFailed: { name: 'AI 실패', color: '#6076de', description: '번역의 문제가 아니라, 이 줄의 AI 단계가 다시 시도해도 끝내 실패함 (연결 끊김, 응답 잘림 등)' },
} as const;
export type IssueKind = keyof typeof ISSUE_KINDS;
export const ISSUE_KIND_IDS = Object.keys(ISSUE_KINDS) as IssueKind[];
/** The kinds a review may name (every kind but AI 실패). */
export const REVIEW_KIND_IDS = ISSUE_KIND_IDS.filter((kind) => kind !== 'aiFailed');
/** How a kind reads where a person maps it to a tag (the 태그 붙이기 node's category map). */
export const ISSUE_KIND_LABELS: Record<IssueKind, string> = { format: '형식', term: '용어', speech: '말투', meaning: '의미', style: '문체', other: '기타', aiFailed: 'AI 실패' };
/** For the AI review prompt: the category ids it may give. */
export const ISSUE_CATEGORY_GUIDE = 'speech (speech level, honorifics, form of address), term (a glossary term or name rendered differently), meaning (mistranslation, omission, addition), style (unnatural or awkward Korean), format (placeholders, tags, line breaks), other';

/** The knowledge items tags go on besides lines (the same project tags, all of them ordinary). */
export const KNOWLEDGE_TAG_KINDS = ['terms', 'documents', 'characters', 'relationships', 'events', 'speechRules'] as const;
export type KnowledgeTagKind = (typeof KNOWLEDGE_TAG_KINDS)[number];

/** Maps a knowledge table kind to its TagScope ('terms' | 'documents' | 'events' | 'people'). */
export function knowledgeKindScope(kind: KnowledgeTagKind): TagScope {
  if (kind === 'terms') return 'terms';
  if (kind === 'documents') return 'documents';
  if (kind === 'events') return 'events';
  return 'people';
}
