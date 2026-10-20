import { z } from 'zod';

/**
 * What a model can take and give in one call, per connection and model: from the provider's model
 * list when it says (OpenRouter's context_length…), or entered by a person (CLI connections).
 */
export const modelLimitsSchema = z.object({
  /** Input and output together, in tokens. */
  contextWindow: z.number().int().positive().optional(),
  /** Most output tokens in one call. */
  maxOutput: z.number().int().positive().optional(),
  /** Where the numbers came from; a person's are never replaced by the provider's. */
  by: z.enum(['api', 'human']).default('api'),
});
export type ModelLimits = z.infer<typeof modelLimitsSchema>;

/** Budgets when the model's limits are unknown (and an AI node's own numbers before "auto"). */
export const DEFAULT_BUDGETS = { lines: 6_000, whole: 300_000, context: 12_000 } as const;

/**
 * Output tokens per input token of line text, by what the node returns: a translation is about as
 * long again in Korean plus the JSON around each line; verdicts and choices are short; extraction is
 * a fraction of what it reads.
 */
const OUTPUT_RATIO = { text: 2.5, verdict: 0.3, choice: 0.3, json: 0.5 } as const;
/** System prompt, instructions and the request's own scaffolding. */
const RESERVE = 3_000;
const roundDown = (value: number) => Math.max(0, Math.floor(value / 500) * 500);

/**
 * "Auto" budgets of an AI node from its model's limits: the context gets a tenth of the window
 * (4k–60k), and the line text gets what is left once room for the expected output is kept,
 * never more than the model's output limit can carry. Unknown limits give DEFAULT_BUDGETS.
 */
export function autoBudgets(limits: Pick<ModelLimits, 'contextWindow' | 'maxOutput'> | undefined, output: keyof typeof OUTPUT_RATIO, mode: 'unit' | 'group' | 'count' | 'whole') {
  const fallback = { lines: mode === 'whole' ? DEFAULT_BUDGETS.whole : DEFAULT_BUDGETS.lines, context: DEFAULT_BUDGETS.context };
  if (!limits?.contextWindow && !limits?.maxOutput) return fallback;
  const ratio = OUTPUT_RATIO[output];
  const window = limits.contextWindow ?? Infinity;
  const context = Number.isFinite(window) ? Math.min(60_000, Math.max(4_000, roundDown(window * 0.1))) : DEFAULT_BUDGETS.context;
  const fromWindow = Number.isFinite(window) ? (window - context - RESERVE) / (1 + ratio) : Infinity;
  const fromOutput = limits.maxOutput ? (limits.maxOutput * 0.9) / ratio : Infinity;
  const lines = Math.max(1_000, roundDown(Math.min(fromWindow, fromOutput)));
  return { lines: Number.isFinite(lines) ? lines : fallback.lines, context };
}

/** The line-text budget a batch config packs to: its own number, or the default when left to "auto" and not resolved. */
export const batchTokens = (config: { mode: string; maxTokens?: number | null }) => config.maxTokens ?? (config.mode === 'whole' ? DEFAULT_BUDGETS.whole : DEFAULT_BUDGETS.lines);
export const contextTokens = (config: { maxTokens?: number | null }) => config.maxTokens ?? DEFAULT_BUDGETS.context;

/**
 * What one line costs a request beyond its text: its number, the JSON around it in the answer.
 * Batches count lines by `lineCost`, so a request of many short lines is bounded by tokens too
 * (there is no separate line-count cap; a model that drops lines in a long list is asked again for those).
 */
export const LINE_OVERHEAD = 20;
/**
 * What a line costs a whole-script request beyond its text: it is sent as compact script text
 * ("  L1234 Speaker: text"), not per-line JSON, so only its id, the speaker and a separator.
 */
export const SCRIPT_LINE_OVERHEAD = 5;
/** A line's cost in a request of batch mode `mode` (whole-script requests are compact text). */
export const lineCostIn = (mode: string) => (line: { tokens: number }) => line.tokens + (mode === 'whole' ? SCRIPT_LINE_OVERHEAD : LINE_OVERHEAD);
export const lineCost = lineCostIn('group');
