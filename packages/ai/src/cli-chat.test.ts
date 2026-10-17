import { describe, expect, it } from 'vitest';
import { cliChatCommand, readCliChat, turnShare } from './cli-chat.ts';
import { CODEX_UNUSED_FEATURES } from './cli.ts';
import type { ResolvedRoute } from './types.ts';

const route: ResolvedRoute = { kind: 'codex', model: 'gpt-6-luna', effort: 'medium' };
const turn = { system: 'System instructions', prompt: 'User message', timeoutMs: 10_000 };

// Shapes as the CLIs print them (grok 1.0.46, Claude Code 2.1, codex 0.154 exec --json, agy 1.3, opencode run --format json).
describe('CLI chat output', () => {
  it('isolates Codex on new and resumed turns and uses only the prompt as its first message', () => {
    for (const chatTurn of [turn, { ...turn, sessionId: 'session-1' }]) {
      const { args, input } = cliChatCommand('codex', route, chatTurn, 'new-id', '/tmp/loca-chat/instructions.md');
      for (const feature of CODEX_UNUSED_FEATURES) expect(args).toContain(`features.${feature}=false`);
      expect(args).toContain('--ignore-user-config');
      expect(args).toContain('model_instructions_file="/tmp/loca-chat/instructions.md"');
      expect(args).toContain('experimental_instructions_file="/tmp/loca-chat/instructions.md"');
      expect(input).toBe('User message');
    }
    expect(cliChatCommand('codex', route, turn, 'new-id', '/tmp/instructions.md').args).toContain('--sandbox');
    expect(cliChatCommand('codex', route, { ...turn, sessionId: 'session-1' }, 'new-id', '/tmp/instructions.md').args).toContain('sandbox_mode="read-only"');
    expect(cliChatCommand('opencode', { ...route, kind: 'opencode' }, turn, 'new-id', '/tmp/instructions.md').input).toBe('System instructions\n\n---\n\nUser message');
  });

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
    expect(readCliChat('codex', out, 'x')).toEqual({ sessionId: 't-9', text: 'first\n\nsecond', usage: { inputTokens: 100, outputTokens: 7 }, ownToolAttempt: true });
    // A resumed turn prints no thread.started: the id we resumed is kept.
    expect(readCliChat('codex', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'again' } }), 't-9').sessionId).toBe('t-9');
  });

  it('marks only Codex calls with two non-empty agent messages as own tool attempts', () => {
    const codex = (messages: string[]) => messages.map((text) => JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })).join('\n');
    expect(readCliChat('codex', codex(['one', 'two']), 'x').ownToolAttempt).toBe(true);
    expect(readCliChat('codex', codex(['one', '']), 'x').ownToolAttempt).toBeUndefined();
    expect(readCliChat('grok', JSON.stringify({ text: 'one\ntwo', sessionId: 'g', usage: {} }), 'x').ownToolAttempt).toBeUndefined();
  });

  it('reads agy stream-json and opencode parts', () => {
    const agy = [{ event: 'init', conversation_id: 'a-1' }, { event: 'result', result: { status: 'SUCCESS', response: 'HERON', usage: { input_tokens: 3, output_tokens: 1 } } }].map((event) => JSON.stringify(event)).join('\n');
    expect(readCliChat('antigravity', agy, 'x')).toMatchObject({ sessionId: 'a-1', text: 'HERON' });
    const opencode = [{ type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } }, { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'The code word was ' } }, { type: 'text', part: { type: 'text', text: 'HERON.' } }]
      .map((event) => JSON.stringify(event))
      .join('\n');
    expect(readCliChat('opencode', opencode, 'x')).toMatchObject({ sessionId: 'ses_1', text: 'The code word was HERON.' });
  });

  it('counts only a turn\'s share when the CLI reports the conversation\'s running total', () => {
    // agy 1.3 on a resumed conversation: 20,333 in after turn 1, 53,130 after turn 2.
    expect(turnShare({ inputTokens: 53_130, outputTokens: 1_343 }, { inputTokens: 20_333, outputTokens: 1_144 })).toEqual({ inputTokens: 32_797, outputTokens: 199 });
    expect(turnShare({ inputTokens: 900 }, undefined)).toEqual({ inputTokens: 900 });
    // A smaller total: the CLI started a new conversation, so the total is the turn.
    expect(turnShare({ inputTokens: 900 }, { inputTokens: 50_000 })).toEqual({ inputTokens: 900 });
  });
});
