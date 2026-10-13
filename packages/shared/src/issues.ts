import type { TagScope } from './marks.ts';
/**
 * Problem-type tags: what kind of problem a check found in a line's current translation. A check
 * that fails puts its kind on the line, the same check passing takes it off, and a new translation
 * text clears them all (they described the old one). They are ordinary tags otherwise: filters,
 * run scopes and conditions use them, so "말투 문제만 다시 번역" is a filter and a run.
 */
export const ISSUE_KINDS = {
  format: { name: '형식', color: '#f97316' },
  term: { name: '용어', color: '#eab308' },
  speech: { name: '말투', color: '#ec4899' },
  meaning: { name: '의미', color: '#ef4444' },
  style: { name: '문체', color: '#8b5cf6' },
  other: { name: '기타 지적', color: '#64748b' },
} as const;
export type IssueKind = keyof typeof ISSUE_KINDS;
export const ISSUE_KIND_IDS = Object.keys(ISSUE_KINDS) as IssueKind[];
/** For the AI review prompt: the category ids it may give. */
export const ISSUE_CATEGORY_GUIDE = 'speech (speech level, honorifics, form of address), term (a glossary term or name rendered differently), meaning (mistranslation, omission, addition), style (unnatural or awkward Korean), format (placeholders, tags, line breaks), other';

/**
 * The knowledge items tags go on besides lines (the same project tags). A person tags them freely;
 * the one tag kept by the app is REVIEW_TAG.
 */
export const KNOWLEDGE_TAG_KINDS = ['terms', 'documents', 'characters', 'relationships', 'events', 'speechRules'] as const;
export type KnowledgeTagKind = (typeof KNOWLEDGE_TAG_KINDS)[number];

/**
 * 확인 권장: an AI item a person should look at before trusting it (a main pair, evidence spoken by
 * someone else, a clash with a person's rule). Analysis puts it on with the reason (shown on hover);
 * a person deciding the item (확인함, 버리기, an edit) takes it off. Knowledge only, never on lines.
 */
export const REVIEW_TAG = { role: 'review', name: '확인 권장', color: '#f59e0b' } as const;
/** Roles of the tags the app keeps: the problem types on lines, and 확인 권장 on knowledge. */
export const TAG_ROLES = [...ISSUE_KIND_IDS, REVIEW_TAG.role] as const;
export type TagRole = IssueKind | typeof REVIEW_TAG.role;

/**
 * Where a tag can be put: the app's tags have a fixed place (problem types on lines, 확인 권장 on
 * knowledge); a person's own tag has the places they chose.
 */
export function tagScope(tag: { role: TagRole | null; scope: readonly TagScope[] }): TagScope[] {
  if (!tag.role) return [...tag.scope];
  return tag.role === REVIEW_TAG.role ? ['knowledge'] : ['lines'];
}
