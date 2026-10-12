import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readCliOutput } from './cli.ts';
import { ModelError } from './errors.ts';

const schema = z.object({ ok: z.boolean() });
const jsonl = (...events: unknown[]) => events.map((event) => JSON.stringify(event)).join('\n');

function failure(run: () => unknown): ModelError {
  try {
    run();
  } catch (error) {
    if (error instanceof ModelError) return error;
  }
  throw new Error('expected a ModelError');
}

// Shapes as the CLIs print them (grok 1.0.46, Claude Code 2.1, codex 0.154 exec --json, agy 1.3, opencode run --format json).
describe('readCliOutput', () => {
  it('reads Grok: cache outside input, reasoning, reported cost', () => {
    const stdout = JSON.stringify(
      { stopReason: 'end_turn', sessionId: 'g-1', usage: { input_tokens: 8692, cache_read_input_tokens: 10624, cache_creation_input_tokens: 0, output_tokens: 90, reasoning_tokens: 85, total_tokens: 19406 }, total_cost_usd: 0.0079, structuredOutput: { ok: true } },
      null,
      2,
    );
    expect(readCliOutput('grok', stdout, schema)).toEqual({ object: { ok: true }, usage: { inputTokens: 19316, cachedInputTokens: 10624, outputTokens: 90, reasoningTokens: 85, costUsd: 0.0079 } });
  });

  it('reads Claude Code with its cost, and treats snake_case stop_reason as truncation', () => {
    const envelope = { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { ok: true }, total_cost_usd: 0.021, usage: { input_tokens: 4, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 30 } };
    expect(readCliOutput('claude', JSON.stringify(envelope), schema)).toEqual({ object: { ok: true }, usage: { inputTokens: 1204, cachedInputTokens: 1000, outputTokens: 30, costUsd: 0.021 } });
    const cut = failure(() => readCliOutput('claude', JSON.stringify({ ...envelope, stop_reason: 'max_tokens' }), schema));
    expect(cut.code).toBe('invalid-output');
    expect(cut.usage).toMatchObject({ outputTokens: 30, costUsd: 0.021 });
  });

  it('keeps the usage of an is_error envelope', () => {
    const error = failure(() => readCliOutput('claude', JSON.stringify({ type: 'result', is_error: true, result: 'Usage limit reached', total_cost_usd: 0.01, usage: { input_tokens: 7, output_tokens: 0 } }), schema));
    expect(error.code).toBe('rate-limit');
    expect(error.usage).toEqual({ inputTokens: 7, outputTokens: 0, costUsd: 0.01 });
  });

  it('reads Codex JSONL plus the last-message file: cached input stays inside input', () => {
    const stdout = jsonl(
      { type: 'thread.started', thread_id: 't-9' },
      { type: 'turn.started' },
      { type: 'turn.completed', usage: { input_tokens: 24763, cached_input_tokens: 24576, output_tokens: 122, reasoning_output_tokens: 64 } },
    );
    expect(readCliOutput('codex', stdout, schema, '{"ok":true}')).toEqual({ object: { ok: true }, usage: { inputTokens: 24763, cachedInputTokens: 24576, outputTokens: 122, reasoningTokens: 64 } });
    const bad = failure(() => readCliOutput('codex', stdout, schema, 'not json'));
    expect(bad.code).toBe('invalid-output');
    expect(bad.usage).toMatchObject({ inputTokens: 24763 });
  });

  it('reads agy\'s result event', () => {
    const stdout = jsonl(
      { event: 'init', conversation_id: 'a-1' },
      { event: 'result', result: { status: 'SUCCESS', structured_output: { ok: true }, usage: { input_tokens: 1200, output_tokens: 30, cache_read_tokens: 900 } } },
    );
    expect(readCliOutput('antigravity', stdout, schema)).toEqual({ object: { ok: true }, usage: { inputTokens: 1200, cachedInputTokens: 900, outputTokens: 30 } });
  });

  it('sums opencode step_finish events', () => {
    const stdout = jsonl(
      { type: 'step_start', part: { type: 'step-start' } },
      { type: 'text', part: { type: 'text', text: '{"ok":' } },
      { type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', cost: 0.002, tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 50, write: 5 } } } },
      { type: 'text', part: { type: 'text', text: ' true}' } },
      { type: 'step_finish', part: { type: 'step-finish', reason: 'stop', cost: 0.003, tokens: { input: 20, output: 5, reasoning: 3, cache: { read: 150, write: 0 } } } },
    );
    expect(readCliOutput('opencode', stdout, schema)).toEqual({
      object: { ok: true },
      usage: { inputTokens: 325, cachedInputTokens: 200, outputTokens: 18, reasoningTokens: 3, costUsd: 0.005 },
    });
  });

  it('carries usage on a schema mismatch', () => {
    const stdout = JSON.stringify({ stopReason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 4 }, total_cost_usd: 0.002, structuredOutput: { ok: 'yes' } });
    const error = failure(() => readCliOutput('grok', stdout, schema));
    expect(error.code).toBe('invalid-output');
    expect(error.transient).toBe(false);
    expect(error.usage).toEqual({ inputTokens: 100, cachedInputTokens: 90, outputTokens: 4, costUsd: 0.002 });
  });

  it('carries usage on invalid JSON text', () => {
    const stdout = JSON.stringify({ type: 'result', is_error: false, result: 'Sorry, I cannot.', usage: { input_tokens: 3, output_tokens: 6 } });
    expect(failure(() => readCliOutput('claude', stdout, schema)).usage).toEqual({ inputTokens: 3, outputTokens: 6 });
  });
});
