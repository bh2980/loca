import { describe, expect, it } from 'vitest';
import { ModelError, readAiSdkUsage, toModelError } from './errors.ts';
import { addUsage, readUsage } from './types.ts';

describe('readUsage', () => {
  it('adds cache reads and writes to the input when they are reported outside it (Anthropic style)', () => {
    const usage = { input_tokens: 8692, cache_read_input_tokens: 10624, cache_creation_input_tokens: 0, output_tokens: 90, reasoning_tokens: 85, total_tokens: 19406 };
    expect(readUsage(usage, 0.0079)).toEqual({ inputTokens: 19316, cachedInputTokens: 10624, outputTokens: 90, reasoningTokens: 85, costUsd: 0.0079 });
    expect(readUsage({ input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 2 })).toEqual({ inputTokens: 125, cachedInputTokens: 100, outputTokens: 2 });
  });

  it('keeps the input as is when the cached part is reported inside it (OpenAI style)', () => {
    const codex = { input_tokens: 24763, cached_input_tokens: 24576, output_tokens: 122, reasoning_output_tokens: 64 };
    expect(readUsage(codex)).toEqual({ inputTokens: 24763, cachedInputTokens: 24576, outputTokens: 122, reasoningTokens: 64 });
    const chat = { prompt_tokens: 50, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } };
    expect(readUsage(chat)).toEqual({ inputTokens: 50, cachedInputTokens: 20, outputTokens: 5, reasoningTokens: 3 });
    expect(readUsage({ input_tokens: 9, output_tokens: 4, output_tokens_details: { reasoning_tokens: 1 } })).toEqual({ inputTokens: 9, outputTokens: 4, reasoningTokens: 1 });
  });

  it('records agy cache reads without adding them to the input', () => {
    expect(readUsage({ input_tokens: 1200, output_tokens: 30, cache_read_tokens: 900 })).toEqual({ inputTokens: 1200, cachedInputTokens: 900, outputTokens: 30 });
  });

  it('reads opencode step tokens: cache outside input, reasoning kept apart from output', () => {
    expect(readUsage({ input: 10, output: 3, reasoning: 2, cache: { read: 4, write: 1 } }, 0.001)).toEqual({
      inputTokens: 15,
      cachedInputTokens: 4,
      outputTokens: 5,
      reasoningTokens: 2,
      costUsd: 0.001,
    });
  });

  it('leaves unreported fields out', () => {
    expect(readUsage({ input_tokens: 3, output_tokens: 1 })).toEqual({ inputTokens: 3, outputTokens: 1 });
    expect(readUsage({ total_cost_usd: 0.5 })).toEqual({ costUsd: 0.5 });
    expect(readUsage(undefined)).toEqual({});
    expect(readUsage('nope')).toEqual({});
  });
});

describe('addUsage', () => {
  it('adds usage across calls without inventing fields', () => {
    expect(addUsage({ inputTokens: 10, outputTokens: 2 }, { inputTokens: 5, cachedInputTokens: 4, outputTokens: 1, costUsd: 0.25 })).toEqual({
      inputTokens: 15,
      cachedInputTokens: 4,
      outputTokens: 3,
      costUsd: 0.25,
    });
    expect(addUsage({}, {})).toEqual({});
  });
});

describe('AI SDK usage', () => {
  it('reads cache reads and reasoning from LanguageModelUsage', () => {
    const usage = { inputTokens: 100, inputTokenDetails: { noCacheTokens: 40, cacheReadTokens: 60, cacheWriteTokens: undefined }, outputTokens: 20, outputTokenDetails: { textTokens: 15, reasoningTokens: 5 }, totalTokens: 120 };
    expect(readAiSdkUsage(usage)).toEqual({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, reasoningTokens: 5 });
    expect(readAiSdkUsage(undefined)).toEqual({});
  });

  it('keeps the usage a ModelError was thrown with', () => {
    const error = new ModelError('invalid-output', 'x', false, { inputTokens: 1 });
    expect(toModelError(error).usage).toEqual({ inputTokens: 1 });
  });
});
