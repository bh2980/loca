import { normalizeTagScopes, type TagScope } from './marks.ts';
/**
 * Problem-type tags: what kind of problem was found in a line's current translation. Checks and
 * reviews only judge; a workflow's 태그 붙이기 node puts a kind on the line (the project gets the
 * kind's tag the first time) and takes it off, and a new translation text clears them all (they
 * described the old one). They are ordinary tags otherwise: filters, run scopes and conditions use
 * them, so "말투 문제만 다시 번역" is a filter and a run.
 */
export const ISSUE_KINDS = {
  format: { name: '형식', color: '#c46016' },
  term: { name: '용어', color: '#b26f00' },
  speech: { name: '말투', color: '#bc5694' },
  meaning: { name: '의미', color: '#d24c49' },
  style: { name: '문체', color: '#8f68cb' },
  other: { name: '기타 지적', color: '#79818c' },
  /** Not a finding about the translation: the line's AI step finally failed (set by an extraction workflow's failure branch; a review never names it). */
  aiFailed: { name: 'AI 실패', color: '#6076de' },
} as const;
export type IssueKind = keyof typeof ISSUE_KINDS;
export const ISSUE_KIND_IDS = Object.keys(ISSUE_KINDS) as IssueKind[];
/** The kinds a review may name (every kind but AI 실패). */
export const REVIEW_KIND_IDS = ISSUE_KIND_IDS.filter((kind) => kind !== 'aiFailed');
/** The problem type a text names: its id ("speech") or its tag name ("말투"), any case; undefined for any other text. */
export function issueKindOf(text: string): IssueKind | undefined {
  const wanted = text.trim().toLowerCase();
  return ISSUE_KIND_IDS.find((kind) => kind === wanted || ISSUE_KINDS[kind].name.toLowerCase() === wanted);
}
/** For the AI review prompt: the category ids it may give. */
export const ISSUE_CATEGORY_GUIDE = 'speech (speech level, honorifics, form of address), term (a glossary term or name rendered differently), meaning (mistranslation, omission, addition), style (unnatural or awkward Korean), format (placeholders, tags, line breaks), other';

/**
 * The knowledge items tags go on besides lines (the same project tags). A person tags them freely;
 * the one tag kept by the app is REVIEW_TAG.
 */
export const KNOWLEDGE_TAG_KINDS = ['terms', 'documents', 'characters', 'relationships', 'events', 'speechRules'] as const;
export type KnowledgeTagKind = (typeof KNOWLEDGE_TAG_KINDS)[number];

/** Maps a knowledge table kind to its TagScope ('terms' | 'documents' | 'events' | 'people'). */
export function knowledgeKindScope(kind: KnowledgeTagKind): TagScope {
  if (kind === 'terms') return 'terms';
  if (kind === 'documents') return 'documents';
  if (kind === 'events') return 'events';
  return 'people';
}

/**
 * 확인 권장: an AI item a person should look at before trusting it (a main pair, evidence spoken by
 * someone else, a clash with a person's rule). Analysis puts it on with the reason (shown on hover);
 * a person deciding the item (확인함, 버리기, an edit) takes it off. Knowledge only, never on lines.
 */
export const REVIEW_TAG = { role: 'review', name: '확인 권장', color: '#c46016' } as const;
/** Roles of the tags the app keeps: the problem types on lines, and 확인 권장 on knowledge. */
export const TAG_ROLES = [...ISSUE_KIND_IDS, REVIEW_TAG.role] as const;
export type TagRole = IssueKind | typeof REVIEW_TAG.role;

/**
 * Where a tag can be put: the app's tags have a fixed place (problem types on lines, 확인 권장 on
 * knowledge); a person's own tag has the places they chose.
 */
export function tagScope(tag: { role: TagRole | null; scope: readonly string[] }): TagScope[] {
  if (!tag.role) return normalizeTagScopes(tag.scope);
  return tag.role === REVIEW_TAG.role ? ['people', 'documents', 'events'] : ['lines'];
}
