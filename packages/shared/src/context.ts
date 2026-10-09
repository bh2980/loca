/** What went into an AI call besides the lines, why, and how big it was. Kept with every run step. */
export const CONTEXT_ITEM_KINDS = {
  term: '용어',
  preceding: '앞 대사',
  character: '인물',
  relationship: '관계',
  scene: '장면',
  previousScene: '이전 장면',
  document: '문서',
} as const;
export type ContextItemKind = keyof typeof CONTEXT_ITEM_KINDS;

/** Filled in this order until the token cap; later kinds are dropped first. */
export const CONTEXT_PRIORITY = Object.keys(CONTEXT_ITEM_KINDS) as ContextItemKind[];

export interface ContextItem {
  kind: ContextItemKind;
  label: string;
  /** Why it was picked, in the words of the rule that picked it. */
  reason: string;
  /** Estimated tokens (UTF-8 bytes / 4). Models count differently. */
  tokens: number;
  included: boolean;
}

/** Rough token count: about 4 bytes of UTF-8 per token. Only for budgets and display; label it as an estimate. */
export const estimateTokens = (value: unknown) => Math.ceil(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length / 4);
