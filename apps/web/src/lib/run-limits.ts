/** A run's caps as the run dialog and the run page's "상한 늘려 재개" form edit them. */
export interface Caps {
  maxCalls?: number;
  maxInputTokens?: number;
}

/** What a field edited so far holds: absent = follow `suggested`, null = cleared by the person. */
export type CapEdits = { maxCalls?: number | null; maxInputTokens?: number | null };

/**
 * What a new run asks for: only the fields the person changed (null = cleared). The server fills in the suggestion for the
 * rest, the same one this dialog shows, as it does for a run started from the chat or the terminal.
 */
export function startLimits(edits: CapEdits): CapEdits {
  return { ...(edits.maxCalls !== undefined && { maxCalls: edits.maxCalls }), ...(edits.maxInputTokens !== undefined && { maxInputTokens: edits.maxInputTokens }) };
}

/** The body of a resume that raises the caps: null where the person emptied a field that had a cap. */
export function resumeLimits(current: Caps | undefined, next: { maxCalls?: number; maxInputTokens?: number }) {
  return {
    ...(current?.maxCalls || next.maxCalls ? { maxCalls: next.maxCalls ?? null } : {}),
    ...(current?.maxInputTokens || next.maxInputTokens ? { maxInputTokens: next.maxInputTokens ?? null } : {}),
  };
}

/** A new run's caps in words, as starting it would set them: what it asks for over the suggestion; 없음 when it has none. */
export function startCaps(asked: CapEdits | undefined, suggested: Caps | undefined) {
  const pick = (key: keyof Caps) => (asked?.[key] === undefined ? suggested?.[key] : asked[key] ?? undefined);
  const calls = pick('maxCalls');
  const input = pick('maxInputTokens');
  const parts = [calls && `호출 ${calls.toLocaleString()}회`, input && `입력 토큰 ${input.toLocaleString()}`].filter(Boolean);
  return parts.length ? `${parts.join(' · ')}에서 멈춤` : '없음';
}
