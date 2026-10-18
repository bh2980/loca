/**
 * Whole-script reads (an AI node with batch mode "whole", e.g. 작품 분석) take minutes and can outgrow
 * the model's output limit; this is what the runner needs to give them room. What such a read finds is a
 * json output that 반영 nodes save (engine/functions/apply.ts, services/ai-knowledge.ts).
 */

/** The answer was cut off at the model's output limit (an API's finishReason length, a CLI saying so). */
export function outputCutOff(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /output token limit|exceeded the (?:maximum )?output|finishReason: length|max_?tokens|response was cut off/i.test(message);
}

/** A whole-script read takes minutes; the connection's per-call timeout is for single scenes. */
export const MIN_ANALYSIS_TIMEOUT_MS = 30 * 60_000;
