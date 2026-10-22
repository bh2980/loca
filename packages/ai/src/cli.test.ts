import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import path from 'node:path';
import { codexModelLimits, execaCli, grokCachePath, grokModelLimits, opencodeCachePath, opencodeModelLimits, readCliOutput } from './cli.ts';
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

  it('tells a prompt too long for the model from other CLI failures', () => {
    const error = failure(() => readCliOutput('claude', JSON.stringify({ type: 'result', is_error: true, result: 'Prompt is too long', usage: { input_tokens: 0, output_tokens: 0 } }), schema));
    expect(error.code).toBe('too-long');
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

describe('a CLI that waits', () => {
  it('gets a closed stdin when the call passes no input, so a CLI reading a pipe cannot wait forever', async () => {
    const result = await execaCli(process.execPath, ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"], { timeout: 10_000 });
    expect(result.exitCode).toBe(0);
  });

});

describe('model limits from the CLIs', () => {
  it('reads codex context_window (not max_context_window) of visible models only', () => {
    const catalog = JSON.stringify({ models: [{ slug: 'gpt-a', visibility: 'list', context_window: 272_000, max_context_window: 1_000_000 }, { slug: 'gpt-b', visibility: 'hide', context_window: 100 }, { slug: 'gpt-c', visibility: 'list' }] });
    expect(codexModelLimits(catalog)).toEqual({ 'gpt-a': { contextWindow: 272_000 } });
    expect(codexModelLimits('not json')).toEqual({});
  });

  it('reads grok window and max_completion_tokens only when it is a positive number', () => {
    const cache = { models: { 'grok-4': { info: { context_window: 256_000, max_completion_tokens: null } }, 'grok-5': { info: { context_window: 2_000_000, max_completion_tokens: 64_000 } }, other: { info: { context_window: 5 } }, 'grok-6': {} } };
    expect(grokModelLimits(cache, ['grok-4', 'grok-5', 'grok-6', 'missing'])).toEqual({ 'grok-4': { contextWindow: 256_000 }, 'grok-5': { contextWindow: 2_000_000, maxOutput: 64_000 } });
    expect(grokModelLimits(undefined, ['grok-4'])).toEqual({});
  });

  it('maps opencode provider/model ids to models.dev limits, and skips what the cache lacks', () => {
    const cache = { anthropic: { models: { 'claude-x': { limit: { context: 200_000, output: 32_000 } } } }, 'amazon-bedrock': { models: { 'a.b/c': { limit: { context: 1_000 } } } } };
    expect(opencodeModelLimits(cache, ['anthropic/claude-x', 'anthropic/nope', 'ghost/m', 'amazon-bedrock/a.b/c', 'plain'])).toEqual({ 'anthropic/claude-x': { contextWindow: 200_000, maxOutput: 32_000 }, 'amazon-bedrock/a.b/c': { contextWindow: 1_000 } });
    expect(opencodeModelLimits(null, ['anthropic/claude-x'])).toEqual({});
  });

  it('finds the cache files under GROK_HOME and XDG_CACHE_HOME when set', () => {
    expect(grokCachePath({ GROK_HOME: '/g' }, '/h')).toBe('/g/models_cache.json'.replaceAll('/', path.sep));
    expect(grokCachePath({}, '/h')).toBe(path.join('/h', '.grok', 'models_cache.json'));
    expect(opencodeCachePath({ XDG_CACHE_HOME: '/x' }, '/h')).toBe(path.join('/x', 'opencode', 'models.json'));
    expect(opencodeCachePath({}, '/h')).toBe(path.join('/h', '.cache', 'opencode', 'models.json'));
  });

  it('learns a claude model\'s window from the result\'s modelUsage, taking the model that did the work', () => {
    const schema = z.object({ ok: z.boolean() });
    const envelope = {
      type: 'result',
      result: '{"ok":true}',
      usage: { input_tokens: 10, output_tokens: 5 },
      modelUsage: { 'claude-haiku': { inputTokens: 5, outputTokens: 1, contextWindow: 200_000, maxOutputTokens: 8_000 }, 'claude-opus': { inputTokens: 900, outputTokens: 50, contextWindow: 1_000_000, maxOutputTokens: 64_000 } },
    };
    expect(readCliOutput('claude', JSON.stringify(envelope), schema).usage.limits).toEqual({ contextWindow: 1_000_000, maxOutput: 64_000 });
    expect(readCliOutput('claude', JSON.stringify({ ...envelope, modelUsage: undefined }), schema).usage.limits).toBeUndefined();
  });
});
