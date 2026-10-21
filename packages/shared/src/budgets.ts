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
 * How much of the model's output limit an answer may be expected to fill, by what the node returns:
 * a translation's length varies most, a verdict or choice the least.
 */
const OUTPUT_MARGIN = { text: 0.75, json: 0.8, verdict: 0.9, choice: 0.9 } as const;

/**
 * "Auto" budgets of an AI node from its model's limits: the context gets a tenth of the window
 * (4k–60k), and the line text gets what is left once room for the expected output is kept,
 * never more than the model's output limit can carry (UNKNOWN_MAX_OUTPUT when only the window is known).
 * Unknown limits give DEFAULT_BUDGETS.
 *
 * The expected output is OUTPUT_RATIO answer tokens per line-text token, kept to OUTPUT_MARGIN of
 * the output limit, both by output kind. The same limits, output kind and mode always give the same
 * sizes. Meant for budgets left to "auto"; a number set on the node is not passed through here.
 */
export function autoBudgets(
  limits: Pick<ModelLimits, 'contextWindow' | 'maxOutput'> | undefined,
  output: keyof typeof OUTPUT_RATIO,
  mode: 'unit' | 'group' | 'count' | 'whole',
): { lines: number; context: number } {
  const per = OUTPUT_RATIO[output];
  const margin = OUTPUT_MARGIN[output];
  let lines: number = mode === 'whole' ? DEFAULT_BUDGETS.whole : DEFAULT_BUDGETS.lines;
  let context: number = DEFAULT_BUDGETS.context;
  if (limits?.contextWindow || limits?.maxOutput) {
    const window = limits.contextWindow ?? Infinity;
    context = Number.isFinite(window) ? Math.min(60_000, Math.max(4_000, roundDown(window * 0.1))) : DEFAULT_BUDGETS.context;
    const fromWindow = Number.isFinite(window) ? (window - context - RESERVE) / (1 + per) : Infinity;
    const maxOutput = limits.maxOutput ?? (Number.isFinite(window) ? UNKNOWN_MAX_OUTPUT : undefined);
    const fromOutput = maxOutput ? (maxOutput * margin) / per : Infinity;
    const sized = Math.max(1_000, roundDown(Math.min(fromWindow, fromOutput)));
    if (Number.isFinite(sized)) lines = sized;
  }
  return { lines, context };
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
