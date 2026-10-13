import type { z } from 'zod';
import type { ConnectionKind } from '@tw/shared';

/** A connection + model with secrets already resolved by the caller. */
export interface ResolvedRoute {
  /** The stored connection it came from, for logs; absent for routes built outside the app (tests, scripts). */
  connectionId?: string;
  kind: ConnectionKind;
  baseUrl?: string;
  executable?: string;
  apiKey?: string;
  model: string;
  effort?: string;
  /** pi connections: what to load besides the workbench tools. */
  piOptions?: import('@tw/shared').PiOptions;
}

/** What a call used, as the connection reported it. Absent fields were not reported. */
export interface Usage {
  /** All input the model read, the cached part included. */
  inputTokens?: number;
  /** The part of `inputTokens` read from the provider's prompt cache. */
  cachedInputTokens?: number;
  /** All output, reasoning included. */
  outputTokens?: number;
  /** The reasoning part of `outputTokens`. */
  reasoningTokens?: number;
  /** USD the connection itself reported (some CLIs do); never an estimate from a price catalog. */
  costUsd?: number;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const obj = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/**
 * A usage record in any of the shapes connections report, normalized to `Usage`.
 * Anthropic-style (`cache_read_input_tokens`; Claude Code, Grok) counts cached input outside
 * `input_tokens`; OpenAI-style (`cached_input_tokens`, `prompt_tokens_details`; Codex) inside it.
 * opencode's step tokens (`input`, `output`, `reasoning`, `cache`) keep reasoning apart from
 * `output` and cache outside `input`.
 */
export function readUsage(raw: unknown, cost?: unknown): Usage {
  const usage = obj(raw);
  const inputDetails = obj(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const outputDetails = obj(usage.output_tokens_details ?? usage.completion_tokens_details);
  const cache = obj(usage.cache);
  const base = num(usage.input_tokens) ?? num(usage.inputTokens) ?? num(usage.prompt_tokens) ?? num(usage.input);
  const cacheRead = num(usage.cache_read_input_tokens) ?? num(usage.cacheReadInputTokens) ?? num(cache.read);
  const cacheWrite = num(usage.cache_creation_input_tokens) ?? num(usage.cacheCreationInputTokens) ?? num(cache.write);
  const included = num(usage.cached_input_tokens) ?? num(usage.cachedInputTokens) ?? num(inputDetails.cached_tokens);
  // agy's cache_read_tokens: unverified whether it is inside input_tokens, so it is recorded but not added.
  const agyCache = num(usage.cache_read_tokens);
  const reasoning = num(usage.reasoning_tokens) ?? num(usage.reasoning_output_tokens) ?? num(outputDetails.reasoning_tokens) ?? num(usage.reasoning);
  const output = num(usage.output_tokens) ?? num(usage.outputTokens) ?? num(usage.completion_tokens);
  const stepOutput = output === undefined ? num(usage.output) : undefined;
  const result: Usage = {};
  if (included !== undefined || agyCache !== undefined) {
    result.inputTokens = base;
    result.cachedInputTokens = included ?? agyCache;
  } else if (cacheRead !== undefined || cacheWrite !== undefined) {
    result.inputTokens = (base ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
    result.cachedInputTokens = cacheRead ?? 0;
  } else result.inputTokens = base;
  result.outputTokens = output ?? (stepOutput === undefined ? undefined : stepOutput + (reasoning ?? 0));
  result.reasoningTokens = reasoning;
  result.costUsd = num(cost) ?? num(usage.total_cost_usd) ?? num(usage.cost);
  for (const key of Object.keys(result) as (keyof Usage)[]) if (result[key] === undefined) delete result[key];
  return result;
}

const USAGE_KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens', 'costUsd'] as const;

/** Usage of several calls added up; a field stays absent only if no call reported it. */
export function addUsage(a: Usage, b: Usage): Usage {
  const sum: Usage = {};
  for (const key of USAGE_KEYS) if (a[key] !== undefined || b[key] !== undefined) sum[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return sum;
}

export interface GenerateRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface GenerateResult<T> {
  object: T;
  usage: Usage;
}

export interface JudgeRequest {
  /** What is being judged (source, candidate, context…). */
  state: Record<string, unknown>;
  instructions: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface JudgeResult {
  passed: boolean;
  confidence: number;
  usage: Usage;
}

/** A typed question for a judgment model (System One). */
export type AskQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions?: string; criteria: Record<string, string> }
  | { type: 'score'; instructions?: string; criteria: string[] };

export interface AskRequest {
  state: unknown;
  questions: Record<string, AskQuestion>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type AskAnswer =
  | { type: 'noul'; /** Probability of yes. */ yes: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; /** Expected score. */ score: number; confidence: number; probabilities: Record<string, number> };

export interface AskResult {
  answers: Record<string, AskAnswer>;
  usage: Usage;
}
