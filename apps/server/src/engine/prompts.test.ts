import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { workflowNodeSchema, type AiNode } from '@tw/shared';
import type { BatchContext } from '../services/context.ts';
import { FORMAT_CHOICE, FORMAT_JSON_BATCH, FORMAT_JSON_LINE, FORMAT_TEXT, INPUT_SCRIPT } from './format-sentences.ts';
import { buildPrompt, formatSentences, isBatchScope, outputSchema, type PromptLine } from './prompts.ts';

const node = (config: Record<string, unknown>) => workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config }) as AiNode;
const context: BatchContext = {
  scenes: { g1: { title: 'Scene' } },
  previousScenes: [],
  pairs: [],
  documents: [],
  aiNotes: { characters: [], relationships: [], documents: [] },
  characters: [],
  speechRules: [],
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
const lines: PromptLine[] = [{ id: '1', unitId: 'u1', groupId: 'g1', key: 'k1', kind: 'dialogue', speaker: 'MIRA', source: 'Hi.' }];
const languages = { source: 'en', target: 'ko' };

describe('outputSchema', () => {
  it('text: one entry per line id with its text', () => {
    const schema = outputSchema(node({ output: 'text' }));
    expect(schema.parse({ results: [{ id: '1', text: '안녕' }] })).toEqual({ results: [{ id: '1', text: '안녕' }] });
    expect(schema.safeParse({ results: [{ id: '1' }] }).success).toBe(false);
  });

  it('verdict keeps passed, issues and categories', () => {
    const schema = outputSchema(node({ output: 'verdict' }));
    expect(schema.parse({ results: [{ id: '1', passed: false, issues: ['x'], categories: ['style'] }] })).toBeTruthy();
    expect(schema.safeParse({ results: [{ id: '1', passed: true, issues: [], categories: ['nope'] }] }).success).toBe(false);
  });

  it('choice: the value is one of the resolved options, null only when none is allowed', () => {
    const open = outputSchema(node({ output: 'choice', choice: { source: 'characters', values: [], allowNone: true } }), undefined, ['Mira', 'group']);
    expect(open.safeParse({ results: [{ id: '1', value: 'Mira', confidence: 0.9 }] }).success).toBe(true);
    expect(open.safeParse({ results: [{ id: '1', value: null, confidence: 0.1 }] }).success).toBe(true);
    expect(open.safeParse({ results: [{ id: '1', value: 'Zed', confidence: 0.9 }] }).success).toBe(false);
    expect(open.safeParse({ results: [{ id: '1', value: 'Mira', confidence: 1.5 }] }).success).toBe(false);
    const strict = outputSchema(node({ output: 'choice', choice: { source: 'custom', values: ['a'], allowNone: false } }));
    expect(strict.safeParse({ results: [{ id: '1', value: null, confidence: 0.5 }] }).success).toBe(false);
    expect(strict.safeParse({ results: [{ id: '1', value: 'a', confidence: 0.5, reason: 'r' }] }).success).toBe(true);
  });

  const fields = [
    { name: 'title', type: 'string', description: '' },
    { name: 'count', type: 'number', description: '' },
    { name: 'tags', type: 'strings', description: '' },
    { name: 'evidence', type: 'lines', description: '' },
    { name: 'people', type: 'list', description: '', fields: [{ name: 'name', type: 'string', description: '' }, { name: 'evidence', type: 'lines', description: '' }, { name: 'alive', type: 'boolean', description: '' }] },
  ];
  const full = { title: 't', count: 2, tags: ['a'], evidence: ['1'], people: [{ name: 'A', evidence: ['1', '2'], alive: true }] };

  it('json line scope: fields (nested lists too) per line id', () => {
    const schema = outputSchema(node({ output: 'json', fields }));
    expect(schema.parse({ results: [{ id: '1', ...full }] })).toEqual({ results: [{ id: '1', ...full }] });
    expect(schema.safeParse({ results: [{ id: '1', ...full, people: [{ name: 'A' }] }] }).success).toBe(false);
  });

  it('json batch scope: one object of the fields', () => {
    const ai = node({ output: 'json', scope: 'batch', fields });
    expect(isBatchScope(ai)).toBe(true);
    expect(outputSchema(ai).parse(full)).toEqual(full);
    expect(outputSchema(ai).safeParse({ results: [] }).success).toBe(false);
  });

  it('says which ids a line-scope answer needs', () => {
    expect(JSON.stringify(outputSchema(node({ output: 'text' }), ['1', '2']))).not.toContain('Exactly');
    const described = JSON.stringify(toJSONSchema(outputSchema(node({ output: 'text' }), ['1', '2'])));
    expect(described).toContain('Exactly 2 entries, one for each line id: 1, 2.');
  });
});

describe('buildPrompt system message', () => {
  it('is the role, the node\'s instructions and one neutral FORMAT sentence, nothing purpose-specific', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ output: 'text' }, FORMAT_TEXT],
      [{ output: 'json', fields: [{ name: 'a', type: 'string' }] }, FORMAT_JSON_LINE],
      [{ output: 'json', scope: 'batch', fields: [{ name: 'a', type: 'string' }] }, FORMAT_JSON_BATCH],
    ];
    for (const [config, sentence] of cases) {
      const { system } = buildPrompt(node({ ...config, instructions: '  Do the thing.  ' }), languages, context, lines);
      expect(system).toContain('You are a professional game localizer working from en to ko.');
      expect(system).toContain('Do the thing.');
      expect(system).toContain(sentence);
      expect(system).not.toMatch(/terms|knowledge|listener|analysis|characters/);
    }
  });

  it('a choice lists its resolved options and what null means', () => {
    const ai = node({ output: 'choice', choice: { source: 'characters', values: [], allowNone: true } });
    const { system } = buildPrompt(ai, languages, context, lines, ['Mira', 'group']);
    expect(system).toContain(FORMAT_CHOICE);
    expect(system).toContain('Options for "value": "Mira", "group". Use null when none of them fits.');
    expect(formatSentences(node({ output: 'choice', choice: { source: 'custom', values: ['a'], allowNone: false } }))).not.toContain('Use null');
  });

  it('the format of a whole-script input is a separate neutral sentence', () => {
    expect(INPUT_SCRIPT).toContain('L<n> <Speaker>: <text>');
    expect(INPUT_SCRIPT).not.toMatch(/Korean|translator|Do NOT/);
  });
  it('sends the talking pairs as a section of the request and says what they are, only when there are some', () => {
    const ai = node({ output: 'json', scope: 'batch' });
    const withPairs = buildPrompt(ai, languages, { ...context, pairs: [{ a: 'JONAS', b: 'MIRA', turns: 4 }] }, lines);
    expect(JSON.parse(withPairs.prompt).talkingPairs).toEqual([{ a: 'JONAS', b: 'MIRA', turns: 4 }]);
    expect(withPairs.system).toContain('"talkingPairs" lists pairs of people who talk to each other');
    const without = buildPrompt(ai, languages, context, lines);
    expect(JSON.parse(without.prompt)).not.toHaveProperty('talkingPairs');
    expect(without.system).not.toContain('talkingPairs');
  });
});
