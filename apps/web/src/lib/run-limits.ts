/** A run's caps as the run dialog and the run page's "상한 늘려 재개" form edit them. */
export interface Caps {
  maxCalls?: number;
  maxInputTokens?: number;
}

/** What a field edited so far holds: absent = follow `suggested`, null = cleared by the person. */
export type CapEdits = { maxCalls?: number | null; maxInputTokens?: number | null };

/** The caps a new run starts with: edits over the suggestion; a cleared or empty cap is left out. */
export function startLimits(suggested: Caps | undefined, edits: CapEdits): Caps {
  const pick = (key: keyof Caps) => (edits[key] === undefined ? suggested?.[key] : edits[key] ?? undefined);
  const maxCalls = pick('maxCalls');
  const maxInputTokens = pick('maxInputTokens');
  return { ...(maxCalls ? { maxCalls } : {}), ...(maxInputTokens ? { maxInputTokens } : {}) };
}

/** The body of a resume that raises the caps: null where the person emptied a field that had a cap. */
export function resumeLimits(current: Caps | undefined, next: { maxCalls?: number; maxInputTokens?: number }) {
  return {
    ...(current?.maxCalls || next.maxCalls ? { maxCalls: next.maxCalls ?? null } : {}),
    ...(current?.maxInputTokens || next.maxInputTokens ? { maxInputTokens: next.maxInputTokens ?? null } : {}),
  };
}
