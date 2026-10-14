import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AI_PRESETS, workflowNodeSchema, type AiNode } from '@tw/shared';
import { DEFAULT_OPTIONS, resolveOptions, respond, usageFor, type MockOptions } from '../../../../scripts/mock-llm-core.ts';
import { analysisSchema } from '../services/analysis.ts';
import type { BatchContext } from '../services/context.ts';
import { buildPrompt, knowledgeOutputSchema, outputSchema, type PromptLine } from './prompts.ts';

/** Regression net: the mock LLM must keep answering in the shape the server's schemas demand. */

const context: BatchContext = {
  scenes: { g1: { title: 'Scene' } },
  previousScenes: [],
  documents: [],
  aiNotes: { characters: [], relationships: [], documents: [] },
  characters: [],
  speech: {},
  voices: {},
  people: {},
  cast: [],
  relationships: [],
  terms: [],
  preceding: {},
  items: [],
  budget: { limit: 1000, used: 0 },
};
const lines: PromptLine[] = [
  ['MIRA', 'The relay station is dark. Someone cut the power, Jonas.'],
  ['JONAS', 'Ignoring whose orders?'],
  ['MIRA', 'Ask the Directorate about it.'],
  ['JONAS', 'Fine.'],
].map(([speaker, source], index) => ({ id: String(index + 1), unitId: `u${index}`, groupId: 'g1', key: `k${index}`, speaker, source, candidate: `[KO] ${source}` }));

const node = (output: AiNode['config']['output'], extra: Partial<AiNode['config']> = {}) =>
  workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config: { output, ...extra } }) as AiNode;

function ask(ai: AiNode, options: Partial<MockOptions> = {}, input: PromptLine[] = lines) {
  const { system, prompt } = buildPrompt(ai, { source: 'en', target: 'ko' }, context, input);
  const schema = z.toJSONSchema(outputSchema(ai));
  return respond({ system, user: prompt, schema }, { ...DEFAULT_OPTIONS, ...options });
}

const jsonNode = node('json', { fields: [{ name: 'tone', type: 'string', description: '' }, { name: 'score', type: 'number', description: '' }, { name: 'ok', type: 'boolean', description: '' }] });
const kinds: [string, AiNode][] = [
  ['candidate', node('candidate')],
  ['revise (candidate)', node('candidate', { instructions: AI_PRESETS.revise.instructions })],
  ['verdict', node('verdict', { instructions: AI_PRESETS.review.instructions })],
  ['terms', node('terms', { instructions: AI_PRESETS.terms.instructions })],
  ['listener', node('listener', { instructions: AI_PRESETS.listener.instructions })],
  ['knowledge', node('knowledge', { instructions: AI_PRESETS.knowledge.instructions })],
  ['json', jsonNode],
];

describe('mock LLM answers match the server schemas', () => {
  for (const [name, ai] of kinds)
    it(`${name} output parses with outputSchema`, () => {
      const outcome = ask(ai);
      expect(outcome.status).toBe(200);
      expect(outcome.finishReason).toBe('stop');
      const parsed = outputSchema(ai).parse(JSON.parse(outcome.content));
      expect(parsed).toBeTruthy();
    });

  it('answers every line exactly once for per-line kinds', () => {
    for (const [name, ai] of kinds.filter(([name]) => !['terms', 'knowledge'].includes(name))) {
      const body = JSON.parse(ask(ai).content) as Record<string, { id: string }[]>;
      expect(Object.values(body)[0].map((entry) => entry.id), name).toEqual(['1', '2', '3', '4']);
    }
  });

  it('json fields follow the node definition', () => {
    const [row] = (JSON.parse(ask(jsonNode).content) as { results: Record<string, unknown>[] }).results;
    expect(typeof row.tone).toBe('string');
    expect(typeof row.score).toBe('number');
    expect(typeof row.ok).toBe('boolean');
  });

  it('knowledge matches knowledgeOutputSchema and cites prompt line ids', () => {
    const body = knowledgeOutputSchema.parse(JSON.parse(ask(node('knowledge', { instructions: AI_PRESETS.knowledge.instructions })).content));
    expect(body.events[0].evidence).toEqual(['1']);
  });

  it('work analysis parses with analysisSchema', () => {
    const script = ['## 1 — Scene [s1]', 'L1 MIRA: Hello.', 'L2 JONAS: Hi.', 'L3 MIRA: Come here.', 'L4 JONAS: No.', 'L5 NARRATOR: Quiet.'].join('\n');
    const outcome = respond({ system: 'You are reading the complete script of a game so that translators into Korean get the background they need.', user: `Return only JSON with "overview"...\n\nSCRIPT:\n${script}` }, DEFAULT_OPTIONS);
    expect(outcome.kind).toBe('analysis');
    const parsed = analysisSchema.parse(JSON.parse(outcome.content));
    expect(parsed.characters.length).toBeGreaterThan(0);
    expect(parsed.speechRules.length).toBeGreaterThan(0);
    // An empty script must still be valid.
    expect(analysisSchema.safeParse(JSON.parse(respond({ system: 'complete script of a game', user: 'SCRIPT:\n' }, DEFAULT_OPTIONS).content)).success).toBe(true);
  });
});

describe('usage', () => {
  it('is token-like with fixed overhead and cache inside the prompt count', () => {
    expect(usageFor(400, 80, { fixedTokens: 20000, cachedTokens: 10000 })).toEqual({
      prompt_tokens: 20100,
      completion_tokens: 20,
      total_tokens: 20120,
      prompt_tokens_details: { cached_tokens: 10000 },
    });
    const outcome = ask(node('candidate'), { fixedTokens: 100, cachedTokens: 40 });
    expect(outcome.usage.prompt_tokens).toBeGreaterThan(100);
    expect(outcome.usage.completion_tokens).toBe(Math.ceil(outcome.content.length / 4));
    expect(outcome.usage.prompt_tokens_details.cached_tokens).toBe(40);
  });
});

describe('profiles and faults', () => {
  it('resolves env-style settings, presets and overrides', () => {
    const get = (settings: Record<string, string>) => (name: string) => settings[name];
    expect(resolveOptions(get({ PROFILE: 'cli-like' }))).toMatchObject({ fixedTokens: 20000, cachedTokens: 10000, latencyMs: 2000 });
    expect(resolveOptions(get({ PROFILE: 'faulty', DROP_RATE: '0.5', '429_RATE': '0' }))).toMatchObject({ dropRate: 0.5, rate429: 0, badJsonRate: 0.02, truncateRate: 0.01 });
    expect(() => resolveOptions(get({ PROFILE: 'nope' }))).toThrow();
  });

  it('drops, duplicates and empties entries', () => {
    const many = Array.from({ length: 40 }, (_, index): PromptLine => ({ id: String(index + 1), unitId: `u${index}`, groupId: 'g1', key: `k${index}`, speaker: 'MIRA', source: `Line ${index}` }));
    const ids = (options: Partial<MockOptions>) => (JSON.parse(ask(node('candidate'), options, many).content) as { translations: { id: string; text: string }[] }).translations;
    expect(ids({ dropRate: 1 })).toHaveLength(0);
    const dup = ids({ dupRate: 1 });
    expect(new Set(dup.map((entry) => entry.id)).size).toBeLessThan(dup.length);
    expect(ids({ emptyRate: 1 }).every((entry) => entry.text === '')).toBe(true);
    const some = ids({ dropRate: 0.5, seed: 3 }).length;
    expect(some).toBeGreaterThan(5);
    expect(some).toBeLessThan(35);
    expect(ids({ dropRate: 0.5, seed: 3 }).length).toBe(some); // seeded
  });

  it('returns bad JSON, truncation and 429', () => {
    const bad = ask(node('candidate'), { badJsonRate: 1 });
    expect(() => JSON.parse(bad.content)).toThrow();
    const cut = ask(node('candidate'), { truncateRate: 1 });
    expect(cut.finishReason).toBe('length');
    expect(() => JSON.parse(cut.content)).toThrow();
    const limited = ask(node('candidate'), { rate429: 1 });
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });
});
