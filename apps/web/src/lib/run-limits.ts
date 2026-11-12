import type { RunCaps } from '@tw/shared';

/** A run's caps as the run dialog and the run page's "상한 늘려 재개" form edit them. */
export interface Caps {
  maxCalls?: number;
  maxInputTokens?: number;
}

/** What a field edited so far holds: absent = follow `suggested`, null = cleared by the person. The caps as the server takes them (runCapsSchema). */
export type CapEdits = RunCaps;

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

export { startCaps } from '@tw/shared';
