import { describe, expect, it } from 'vitest';
import { readCliChat } from './cli-chat.ts';

// Shapes as the CLIs print them (grok 1.0.46, Claude Code 2.1, codex 0.154 exec --json, agy 1.3, opencode run --format json).
describe('CLI chat output', () => {
  it('reads Grok\'s pretty-printed object and Claude Code\'s result line', () => {
    const grok = JSON.stringify({ text: 'OK.', sessionId: 'g-1', usage: { input_tokens: 10, output_tokens: 2 } }, null, 2);
    expect(readCliChat('grok', grok, 'x')).toEqual({ sessionId: 'g-1', text: 'OK.', usage: { inputTokens: 10, outputTokens: 2 } });
    const claude = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '안녕', session_id: 'c-1', usage: { input_tokens: 5, output_tokens: 1 } });
    expect(readCliChat('claude', claude, 'x')).toMatchObject({ sessionId: 'c-1', text: '안녕' });
    expect(() => readCliChat('claude', JSON.stringify({ type: 'result', is_error: true, result: 'Usage limit reached' }), 'x')).toThrow(/한도/);
  });

  it('reads Codex JSONL: the thread id and every agent message', () => {
    const out = [
      { type: 'thread.started', thread_id: 't-9' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } },
      { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'first' } },
      { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'second' } },
      { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 7 } },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(readCliChat('codex', out, 'x')).toEqual({ sessionId: 't-9', text: 'first\n\nsecond', usage: { inputTokens: 100, outputTokens: 7 } });
    // A resumed turn prints no thread.started: the id we resumed is kept.
    expect(readCliChat('codex', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'again' } }), 't-9').sessionId).toBe('t-9');
  });

  it('reads agy stream-json and opencode parts', () => {
    const agy = [{ event: 'init', conversation_id: 'a-1' }, { event: 'result', result: { status: 'SUCCESS', response: 'HERON', usage: { input_tokens: 3, output_tokens: 1 } } }].map((event) => JSON.stringify(event)).join('\n');
    expect(readCliChat('antigravity', agy, 'x')).toMatchObject({ sessionId: 'a-1', text: 'HERON' });
    const opencode = [{ type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } }, { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'The code word was ' } }, { type: 'text', part: { type: 'text', text: 'HERON.' } }]
      .map((event) => JSON.stringify(event))
      .join('\n');
    expect(readCliChat('opencode', opencode, 'x')).toMatchObject({ sessionId: 'ses_1', text: 'The code word was HERON.' });
  });
});
