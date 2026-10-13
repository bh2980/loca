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
