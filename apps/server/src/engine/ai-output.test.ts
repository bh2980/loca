import { describe, expect, it } from 'vitest';
import { workflowNodeSchema, type AiNode } from '@tw/shared';
import { readAiOutput } from './ai-output.ts';

const node = (config: Record<string, unknown>) => workflowNodeSchema.parse({ id: 'n', type: 'ai', position: { x: 0, y: 0 }, config }) as AiNode;
const lines = [{ id: '1', key: 'k1' }, { id: '2', key: 'k2' }] as never;

describe('reading an AI answer line by line (#49)', () => {
  it('text: a candidate; a missing or blank text leaves the line out', () => {
    const out = readAiOutput(node({ output: 'text' }), { results: [{ id: '1', text: '안녕' }, { id: '2', text: '  ' }] }, lines, 'm');
    expect(out[0]).toEqual({ port: 'out', candidate: '안녕', origin: 'ai', model: 'm', output: { text: '안녕' } });
    expect(out[1]).toBeNull();
  });

  it('verdict: passing clears every kind; failing without a category is 기타 (other)', () => {
    const out = readAiOutput(node({ output: 'verdict' }), { results: [{ id: '1', passed: true, issues: [] }, { id: '2', passed: false, issues: ['x'] }] }, lines, 'm');
    expect(out[0]).toMatchObject({ port: 'pass', issues: undefined, issueTags: { clear: 'all' } });
    expect(out[1]).toMatchObject({ port: 'fail', issues: ['x'], output: { categories: ['other'] }, issueTags: { add: ['other'] } });
  });

  it('choice: value, clamped confidence and reason; an answer outside the options is none; a missing line is left out', () => {
    const ai = node({ output: 'choice', choice: { source: 'custom', values: ['Bob', 'group'], allowNone: true } });
    const out = readAiOutput(ai, { results: [{ id: '1', value: ' Bob ', confidence: 3, reason: ' why ' }, { id: '2', value: 'Zed', confidence: 'x' }] }, lines, 'm');
    expect(out.map((entry) => entry?.output)).toEqual([{ value: 'Bob', confidence: 1, reason: 'why' }, { value: null, confidence: 0 }]);
    expect(out[0]).toMatchObject({ port: 'out' });
    expect(readAiOutput(ai, { results: [{ id: '2', value: null, confidence: 0.2 }] }, lines, 'm')).toEqual([null, { port: 'out', output: { value: null, confidence: 0.2 } }]);
    // The resolved options (a project list) decide, not the node's typed ones.
    const listed = node({ output: 'choice', choice: { source: 'characters', values: [], allowNone: true } });
    expect(readAiOutput(listed, { results: [{ id: '1', value: 'Mira', confidence: 0.9 }, { id: '2', value: 'Zed', confidence: 0.9 }] }, lines, 'm', ['Mira']).map((entry) => (entry?.output as { value: string | null }).value)).toEqual(['Mira', null]);
  });

  it('json line scope: the fields without the id; a line not answered is left out', () => {
    const out = readAiOutput(node({ output: 'json', fields: [{ name: 'score', type: 'number' }] }), { results: [{ id: '2', score: 4 }] }, lines, 'm');
    expect(out).toEqual([null, { port: 'out', output: { score: 4 } }]);
  });

  const fields = [
    { name: 'title', type: 'string' },
    { name: 'evidence', type: 'lines' },
    { name: 'people', type: 'list', fields: [{ name: 'name', type: 'string' }, { name: 'evidence', type: 'lines' }, { name: 'moments', type: 'list', fields: [{ name: 'at', type: 'lines' }] }] },
  ];

  it('json: lines fields become line keys at any depth, unknown ids are dropped', () => {
    const [out] = readAiOutput(
      node({ output: 'json', fields }),
      { results: [{ id: '1', title: 't', evidence: ['2', 'gone'], people: [{ name: 'A', evidence: ['1', ' 2 '], moments: [{ at: ['2'] }, { at: ['nope'] }] }] }] },
      lines,
      'm',
    );
    expect(out!.output).toEqual({ title: 't', evidence: ['k2'], people: [{ name: 'A', evidence: ['k1', 'k2'], moments: [{ at: ['k2'] }, { at: [] }] }] });
  });

  it('json batch scope: only the first line carries the answer (batchLeader), with line keys', () => {
    const raw = { title: 't', evidence: ['1'], people: [{ name: 'A', evidence: ['2'], moments: [] }] };
    const out = readAiOutput(node({ output: 'json', scope: 'batch', fields }), raw, lines, 'm');
    expect(out.map((entry) => entry?.output)).toEqual([{ title: 't', evidence: ['k1'], people: [{ name: 'A', evidence: ['k2'], moments: [] }], batchLeader: true }, { batchLeader: false }]);
  });
  it('json: a line that breaks its field limits (empty required text, number out of bounds) is left out to be asked again', () => {
    const fields = [{ name: 'value', type: 'string', required: true }, { name: 'confidence', type: 'number', min: 0, max: 1 }];
    const out = readAiOutput(node({ output: 'json', fields }), { results: [{ id: '1', value: ' ', confidence: 0.9 }, { id: '2', value: 'MIRA', confidence: 43 }] }, lines, 'm');
    expect(out).toEqual([null, null]);
    const ok = readAiOutput(node({ output: 'json', fields }), { results: [{ id: '1', value: 'MIRA', confidence: 0.9 }, { id: '2', value: 'unknown', confidence: 0 }] }, lines, 'm');
    expect(ok.map((entry) => entry?.output)).toEqual([{ value: 'MIRA', confidence: 0.9 }, { value: 'unknown', confidence: 0 }]);
  });
});
