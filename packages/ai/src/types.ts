import type { z } from 'zod';
import type { ConnectionKind } from '@tw/shared';

/** A connection + model with secrets already resolved by the caller. */
export interface ResolvedRoute {
  kind: ConnectionKind;
  baseUrl?: string;
  executable?: string;
  apiKey?: string;
  model: string;
  effort?: string;
  /** pi connections: what to load besides the workbench tools. */
  piOptions?: import('@tw/shared').PiOptions;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
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
