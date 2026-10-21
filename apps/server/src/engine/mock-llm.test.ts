import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AI_PRESET_IDS, presetConfig, workflowNodeSchema, type AiNode, type JsonField } from '@tw/shared';
import { DEFAULT_OPTIONS, resolveOptions, respond, usageFor, type MockOptions } from '../../../../scripts/mock-llm-core.ts';
import type { BatchContext } from '../services/context.ts';
import { INPUT_SCRIPT } from './format-sentences.ts';
import { buildPrompt, outputSchema, type PromptLine } from './prompts.ts';

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
].map(([speaker, source], index) => ({ id: String(index + 1), unitId: `u${index}`, groupId: 'g1', key: `k${index}`, kind: 'dialogue', speaker, source, candidate: `[KO] ${source}` }));

const node = (output: AiNode['config']['output'], extra: Partial<AiNode['config']> = {}) =>
  workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config: { output, ...extra } }) as AiNode;

function ask(ai: AiNode, options: Partial<MockOptions> = {}, input: PromptLine[] = lines, choiceOptions?: string[]) {
  const { system, prompt } = buildPrompt(ai, { source: 'en', target: 'ko' }, context, input, choiceOptions);
  const schema = z.toJSONSchema(outputSchema(ai, undefined, choiceOptions));
  return respond({ system, user: prompt, schema }, { ...DEFAULT_OPTIONS, ...options });
}

const jsonNode = node('json', { fields: [{ name: 'tone', type: 'string', description: '' }, { name: 'score', type: 'number', description: '' }, { name: 'ok', type: 'boolean', description: '' }] });
const termsField: JsonField = { name: 'terms', type: 'list', description: '', fields: [{ name: 'source', type: 'string', description: '' }, { name: 'tags', type: 'strings', description: '' }, { name: 'evidence', type: 'lines', description: '' }, { name: 'ok', type: 'boolean', description: '' }] };
const batchNode = node('json', { scope: 'batch', fields: [{ name: 'title', type: 'string', description: '' }, termsField] });
const choiceNode = node('choice', { choice: { source: 'custom', values: ['MIRA', 'JONAS', 'group'], allowNone: true } });
const kinds: [string, AiNode][] = [
  ['text', node('text')],
  ['revise (text)', node('text', { instructions: 'Revise each translation to fix the issues.' })],
  ['verdict', node('verdict', { instructions: 'Review each translation.' })],
  ['choice', choiceNode],
  ['json', jsonNode],
  ['json with nested list (line scope)', node('json', { fields: [termsField] })],
];

describe('mock LLM answers match the server schemas', () => {
  for (const [name, ai] of kinds)
    it(`${name} output parses with outputSchema`, () => {
      const outcome = ask(ai);
      expect(outcome.status).toBe(200);
      expect(outcome.finishReason).toBe('stop');
      expect(outputSchema(ai).parse(JSON.parse(outcome.content))).toBeTruthy();
    });

  it('answers every line exactly once for line-scope kinds', () => {
    for (const [name, ai] of kinds) {
      const body = JSON.parse(ask(ai).content) as { results: { id: string }[] };
      expect(body.results.map((entry) => entry.id), name).toEqual(['1', '2', '3', '4']);
    }
  });

  it("recognises the kind from the server's FORMAT sentences", () => {
    expect(ask(node('text')).kind).toBe('text');
    expect(ask(node('text', { instructions: 'Revise each translation.' })).kind).toBe('revise');
    expect(ask(node('verdict')).kind).toBe('verdict');
    expect(ask(choiceNode).kind).toBe('choice');
    expect(ask(jsonNode).kind).toBe('json');
    expect(ask(batchNode).kind).toBe('jsonBatch');
  });

  it('json fields follow the node definition', () => {
    const [row] = (JSON.parse(ask(jsonNode).content) as { results: Record<string, unknown>[] }).results;
    expect(typeof row.tone).toBe('string');
    expect(typeof row.score).toBe('number');
    expect(typeof row.ok).toBe('boolean');
  });

  it('a choice picks among the given options with confidence 0.9 (the next other speaker when it is one)', () => {
    const { results } = JSON.parse(ask(choiceNode, {}, lines, choiceNode.config.choice.values).content) as { results: { value: string; confidence: number }[] };
    expect(results.map((entry) => entry.value)).toEqual(['JONAS', 'MIRA', 'JONAS', 'MIRA']);
    expect(results.every((entry) => entry.confidence === 0.9)).toBe(true);
    const plain = node('choice', { choice: { source: 'custom', values: ['a', 'b'], allowNone: false } });
    expect((JSON.parse(ask(plain, {}, lines, ['a', 'b']).content) as { results: { value: string }[] }).results.map((entry) => entry.value)).toEqual(['a', 'a', 'a', 'a']);
  });

  it('every preset\'s mock answer parses with the server schema', () => {
    for (const id of AI_PRESET_IDS) {
      const ai = workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config: presetConfig(id, { connectionId: 'c', model: 'm' }) }) as AiNode;
      const outcome = ask(ai, {}, lines, ai.config.choice.values);
      expect(() => outputSchema(ai, undefined, ai.config.choice.values).parse(JSON.parse(outcome.content)), id).not.toThrow();
    }
  });

  it('batch json is one object with nested items and evidence ids of the request', () => {
    const body = outputSchema(batchNode).parse(JSON.parse(ask(batchNode).content)) as { title: string; terms: { source: string; tags: string[]; evidence: string[]; ok: boolean }[] };
    expect(body.title).toBe('모의 title');
    expect(body.terms).toHaveLength(2);
    expect(body.terms[0].evidence).toEqual(['1', '2']);
    expect(body.terms[0].tags.length).toBeGreaterThan(0);
  });

  it("a whole-script request is read from the script text with the script's own line ids", () => {
    const script = ['## 1 — Scene [s1]', '  L1 MIRA: Hello.', '  L2 JONAS: Hi.', '  L3 [UI]: Start', '  L4 MIRA: Come here.'].join('\n');
    const whole = node('json', { scope: 'batch', fields: [{ name: 'people', type: 'list', description: '', fields: [{ name: 'name', type: 'string', description: '' }, { name: 'evidence', type: 'lines', description: '' }] }] });
    const { system } = buildPrompt(whole, { source: 'en', target: 'ko' }, context, lines);
    const schema = z.toJSONSchema(outputSchema(whole));
    const outcome = respond({ system: `${system}\n\n${INPUT_SCRIPT}`, user: `SCRIPT:\n${script}`, schema }, DEFAULT_OPTIONS);
    expect(outcome.lines).toBe(4);
    const body = outputSchema(whole).parse(JSON.parse(outcome.content)) as { people: { name: string; evidence: string[] }[] };
    expect(body.people.map((person) => person.name)).toEqual(['MIRA', 'JONAS']);
    expect(body.people[0].evidence).toEqual(['L1', 'L2']);
    // An empty script must still be valid.
    expect(outputSchema(whole).safeParse(JSON.parse(respond({ system: `${system}\n\n${INPUT_SCRIPT}`, user: 'SCRIPT:\n', schema }, DEFAULT_OPTIONS).content)).success).toBe(true);
  });
});

describe('prompt line kinds', () => {
  it('mark narration, UI (with its key) and documents, and explain only the kinds in the batch', () => {
    const mixed: PromptLine[] = [
      { id: '1', unitId: 'u1', groupId: 'g1', key: 'k1', kind: 'dialogue', speaker: 'MIRA', source: 'Hi.' },
      { id: '2', unitId: 'u2', groupId: 'g1', key: 'k2', kind: 'dialogue', speaker: null, source: 'Rain falls.' },
      { id: '3', unitId: 'u3', groupId: 'g2', key: 'menu.start', kind: 'ui', speaker: null, source: 'Start' },
    ];
    const { system, prompt } = buildPrompt(node('text'), { source: 'en', target: 'ko' }, context, mixed);
    const sent = (JSON.parse(prompt) as { scenes: { lines: { id: string; kind?: string; key?: string }[] }[] }).scenes.flatMap((scene) => scene.lines);
    expect(sent.map((line) => [line.kind, line.key])).toEqual([[undefined, undefined], ['narration', undefined], ['ui', 'menu.start']]);
    expect(system).toContain('"narration"');
    expect(system).toContain('"ui"');
    expect(system).not.toContain('"document"');
    expect(buildPrompt(node('text'), { source: 'en', target: 'ko' }, context, lines).system).not.toContain('"kind"');
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
    const outcome = ask(node('text'), { fixedTokens: 100, cachedTokens: 40 });
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
    const many = Array.from({ length: 40 }, (_, index): PromptLine => ({ id: String(index + 1), unitId: `u${index}`, groupId: 'g1', key: `k${index}`, kind: 'dialogue', speaker: 'MIRA', source: `Line ${index}` }));
    const ids = (options: Partial<MockOptions>) => (JSON.parse(ask(node('text'), options, many).content) as { results: { id: string; text: string }[] }).results;
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
    const bad = ask(node('text'), { badJsonRate: 1 });
    expect(() => JSON.parse(bad.content)).toThrow();
    const cut = ask(node('text'), { truncateRate: 1 });
    expect(cut.finishReason).toBe('length');
    expect(() => JSON.parse(cut.content)).toThrow();
    // Cut short only when the request carries more line text than the limit.
    expect(ask(node('text'), { truncateOverChars: 1 }).finishReason).toBe('length');
    expect(ask(node('text'), { truncateOverChars: 100_000 }).finishReason).toBe('stop');
    const limited = ask(node('text'), { rate429: 1 });
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });
});
