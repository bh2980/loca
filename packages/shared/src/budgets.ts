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
/**
 * What is assumed when nothing says how long one answer may be (the window is known, the output
 * limit is not): a person's 출력 토큰 or a listed limit replaces it.
 */
export const UNKNOWN_MAX_OUTPUT = 16_000;
/** System prompt, instructions and the request's own scaffolding. */
const RESERVE = 3_000;
const roundDown = (value: number) => Math.max(0, Math.floor(value / 500) * 500);

/**
 * How much of the model's output limit an answer may be expected to fill when nothing has been
 * measured, by what the node returns: a translation's length varies most, a verdict or choice the
 * least. Replaces the node's own history once there is some (HISTORY_MARGIN).
 */
const OUTPUT_MARGIN = { text: 0.75, json: 0.8, verdict: 0.9, choice: 0.9 } as const;
/** With a measured ratio the percentile already carries the safety, so only this is kept back. */
const HISTORY_MARGIN = 0.95;
/** Past requests needed before their answer ratio replaces the default ratio. */
export const MIN_HISTORY_SAMPLES = 3;
/** Which of the measured answer ratios is used: the 90th percentile, so most requests fit. */
const RATIO_PERCENTILE = 0.9;
/** An auto request may grow to this multiple of the largest one that succeeded. */
const GROWTH = 1.5;
/** An auto request stays below this fraction of the smallest one that was cut off. */
const CUT_OFF_SHARE = 0.8;
/** The smallest budget a history cap leaves. */
const CAP_FLOOR = 500;

/**
 * What a node's own past requests say (same workflow, AI node and model), sizes in line-text tokens
 * as a request counts them (lineCostIn):
 * - `ratios`: per request, answer tokens / line-text tokens, from requests that were answered (a
 *   partly answered one counting only the lines it answered);
 * - `largestOk`: the largest request answered in full; `smallestCutOff`: the smallest whose answer was cut off.
 */
export interface BudgetHistory {
  ratios: number[];
  largestOk: number | null;
  smallestCutOff: number | null;
}

/** Which number of `autoBudgets` came from where: the node's history, or the defaults by output kind. */
export interface RatioSource {
  /** Answer tokens per line-text token that sizing assumed. */
  value: number;
  by: 'history' | 'default';
  /** Past requests it was measured from (0 for the default). */
  samples: number;
}
/** The history cap that lowered an auto budget: 'grown' (1.5 × the largest request that worked) or 'cut-off' (0.8 × the smallest that was cut off). */
export interface BudgetCap {
  by: 'grown' | 'cut-off';
  tokens: number;
}

/** Nearest-rank percentile of numbers (any order). */
const percentile = (values: number[], share: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * share) - 1)]!;

/**
 * "Auto" budgets of an AI node from its model's limits: the context gets a tenth of the window
 * (4k–60k), and the line text gets what is left once room for the expected output is kept,
 * never more than the model's output limit can carry (UNKNOWN_MAX_OUTPUT when only the window is known).
 * Unknown limits give DEFAULT_BUDGETS.
 *
 * The expected output is `ratio` answer tokens per line-text token, kept to `margin` of the output
 * limit. Without `history` (or with fewer than MIN_HISTORY_SAMPLES answered requests) the ratio is
 * OUTPUT_RATIO and the margin OUTPUT_MARGIN, both by output kind. With it the ratio is the 90th
 * percentile of what past requests needed and the margin HISTORY_MARGIN. Then the line budget may not
 * exceed 1.5 × the largest request that succeeded, nor 0.8 × the smallest one that was cut off
 * (never below CAP_FLOOR); `cap` says which lowered it. Meant for budgets left to "auto"; a number
 * set on the node is not passed through here.
 */
export function autoBudgets(
  limits: Pick<ModelLimits, 'contextWindow' | 'maxOutput'> | undefined,
  output: keyof typeof OUTPUT_RATIO,
  mode: 'unit' | 'group' | 'count' | 'whole',
  history?: BudgetHistory,
): { lines: number; context: number; ratio: RatioSource; cap: BudgetCap | null } {
  const measured = history && history.ratios.length >= MIN_HISTORY_SAMPLES;
  const ratio: RatioSource = measured ? { value: percentile(history.ratios, RATIO_PERCENTILE), by: 'history', samples: history.ratios.length } : { value: OUTPUT_RATIO[output], by: 'default', samples: 0 };
  const margin = measured ? HISTORY_MARGIN : OUTPUT_MARGIN[output];
  const fallback = { lines: mode === 'whole' ? DEFAULT_BUDGETS.whole : DEFAULT_BUDGETS.lines, context: DEFAULT_BUDGETS.context };
  let lines: number = fallback.lines;
  let context: number = fallback.context;
  if (limits?.contextWindow || limits?.maxOutput) {
    // A ratio of nearly nothing would divide to infinity; the window still bounds the request.
    const per = Math.max(ratio.value, 0.01);
    const window = limits.contextWindow ?? Infinity;
    context = Number.isFinite(window) ? Math.min(60_000, Math.max(4_000, roundDown(window * 0.1))) : DEFAULT_BUDGETS.context;
    const fromWindow = Number.isFinite(window) ? (window - context - RESERVE) / (1 + per) : Infinity;
    const maxOutput = limits.maxOutput ?? (Number.isFinite(window) ? UNKNOWN_MAX_OUTPUT : undefined);
    const fromOutput = maxOutput ? (maxOutput * margin) / per : Infinity;
    const sized = Math.max(1_000, roundDown(Math.min(fromWindow, fromOutput)));
    if (Number.isFinite(sized)) lines = sized;
  }
  const caps: BudgetCap[] = [];
  if (history?.largestOk) caps.push({ by: 'grown', tokens: Math.max(CAP_FLOOR, roundDown(history.largestOk * GROWTH)) });
  if (history?.smallestCutOff) caps.push({ by: 'cut-off', tokens: Math.max(CAP_FLOOR, roundDown(history.smallestCutOff * CUT_OFF_SHARE)) });
  const cap = caps.sort((a, b) => a.tokens - b.tokens).find((candidate) => candidate.tokens < lines) ?? null;
  return { lines: cap ? cap.tokens : lines, context, ratio, cap };
}

/**
 * What a call through this connection may take in and give out: the connection's own 입력·출력 토큰
 * when a person set them, else what the model list said about the chosen model; undefined when neither is known.
 */
export function limitsFor(connection: { inputTokens: number | null; outputTokens: number | null; modelLimits: Record<string, ModelLimits> } | undefined, model: string): ModelLimits | undefined {
  if (!connection) return undefined;
  const listed = connection.modelLimits[model];
  const contextWindow = connection.inputTokens ?? listed?.contextWindow;
  const maxOutput = connection.outputTokens ?? listed?.maxOutput;
  return contextWindow || maxOutput ? { contextWindow, maxOutput, by: connection.inputTokens || connection.outputTokens ? 'human' : 'api' } : undefined;
}

/** Where one of a request's limits comes from: a person's number, the model list or a learned call, or the assumption UNKNOWN_MAX_OUTPUT. */
export type LimitSource = 'human' | 'api' | 'assumed';

/**
 * The limits limitsFor reads, with where each came from, as autoBudgets uses them: null/null for one
 * that is unknown, except the output once the window is known (UNKNOWN_MAX_OUTPUT, 'assumed'). Both
 * null means the default budgets applied.
 */
export function limitsWithSource(connection: { inputTokens: number | null; outputTokens: number | null; modelLimits: Record<string, ModelLimits> } | undefined, model: string) {
  const listed = connection?.modelLimits[model];
  const input: { tokens: number | null; by: 'human' | 'api' | null } =
    connection?.inputTokens != null ? { tokens: connection.inputTokens, by: 'human' } : listed?.contextWindow ? { tokens: listed.contextWindow, by: listed.by } : { tokens: null, by: null };
  const output: { tokens: number | null; by: LimitSource | null } =
    connection?.outputTokens != null
      ? { tokens: connection.outputTokens, by: 'human' }
      : listed?.maxOutput
        ? { tokens: listed.maxOutput, by: listed.by }
        : input.tokens !== null
          ? { tokens: UNKNOWN_MAX_OUTPUT, by: 'assumed' }
          : { tokens: null, by: null };
  return { input, output };
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
