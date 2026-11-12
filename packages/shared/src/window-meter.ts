/**
 * The share of the model's window the last answer's input used, as the "문맥 N%" meter shows it.
 * Null (the meter hides) when the window or the input is unknown.
 */
export function windowMeter(input: { inputTokens: number | null | undefined; window: number | null | undefined }) {
  if (!input.window || input.window <= 0 || input.inputTokens === null || input.inputTokens === undefined) return null;
  // More than the window: one request cannot be, so it is a turn's sum over the agent's own steps (ACP agents report a
  // turn), each reading the conversation again. It says nothing about how full the window is: no percent, no warning.
  if (input.inputTokens > input.window) return { percent: null, tokens: input.inputTokens, window: input.window, level: 'ok' as const };
  const percent = Math.max(0, Math.round((input.inputTokens / input.window) * 100));
  return { percent, tokens: input.inputTokens, window: input.window, level: percent >= 95 ? ('full' as const) : percent >= 80 ? ('high' as const) : ('ok' as const) };
}

/**
 * Where the conversation's start was summarized (chat-compaction.ts stores `upTo`: messages before
 * it are in the summary), as the panel marks it: before the message at `index`, or after the last
 * one when everything so far is summarized (/compact). Null when there is none or it covers more
 * than the record holds.
 */
export function compactionMarker(compaction: { upTo: number; summary: string; at: number } | null | undefined, messageCount: number) {
  if (!compaction || compaction.upTo <= 0 || compaction.upTo > messageCount) return null;
  return { index: compaction.upTo, summary: compaction.summary, at: compaction.at };
}
