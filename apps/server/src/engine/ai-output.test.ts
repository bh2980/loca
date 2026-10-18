import { describe, expect, it } from 'vitest';
import { readAiOutput } from './ai-output.ts';

const node = (output: string, extra: Record<string, unknown> = {}) => ({ id: 'n', type: 'ai', config: { output, ...extra } }) as never;
const lines = [{ id: '1', key: 'k1' }, { id: '2', key: 'k2' }] as never;

describe('reading an AI answer line by line (#49)', () => {
  it('candidate: a missing or blank translation leaves the line out', () => {
    const out = readAiOutput(node('candidate'), { translations: [{ id: '1', text: '안녕' }, { id: '2', text: '  ' }] }, lines, 'm');
    expect(out[0]).toEqual({ port: 'out', candidate: '안녕', origin: 'ai', model: 'm', output: { text: '안녕' } });
    expect(out[1]).toBeNull();
  });

  it('verdict: passing clears every kind; failing without a category is 기타 (other)', () => {
    const out = readAiOutput(node('verdict'), { results: [{ id: '1', passed: true, issues: [] }, { id: '2', passed: false, issues: ['x'] }] }, lines, 'm');
    expect(out[0]).toMatchObject({ port: 'pass', issues: undefined, issueTags: { clear: 'all' } });
    expect(out[1]).toMatchObject({ port: 'fail', issues: ['x'], output: { categories: ['other'] }, issueTags: { add: ['other'] } });
  });

  it('listener: trims the name, clamps confidence, a blank name is no listener', () => {
    const out = readAiOutput(node('listener'), { listeners: [{ id: '1', value: ' Bob ', confidence: 3, reason: ' why ' }, { id: '2', value: ' ', confidence: 'x' }] }, lines, 'm');
    expect(out.map((entry) => entry?.output)).toEqual([{ value: 'Bob', confidence: 1, reason: 'why' }, { value: null, confidence: 0 }]);
  });

  it('json: the fields without the id; a line not answered is left out', () => {
    const out = readAiOutput(node('json'), { results: [{ id: '2', score: 4 }] }, lines, 'm');
    expect(out).toEqual([null, { port: 'out', output: { score: 4 } }]);
  });

  it('terms and knowledge: the first line carries the batch, line ids become keys', () => {
    const terms = readAiOutput(node('terms'), { terms: [{ source: 'a' }] }, lines, 'm');
    expect(terms.map((entry) => entry?.output)).toEqual([{ terms: [{ source: 'a' }], batchLeader: true }, { terms: [{ source: 'a' }], batchLeader: false }]);
    const raw = { characters: [{ name: 'A', evidence: ['1', 'gone'] }], relationships: [{ from: 'A', to: 'B', at: '2' }], events: [{ title: 'e', evidence: ['2'] }], speechRules: [{ speaker: 'A', start: 'nope' }] };
    const [first, second] = readAiOutput(node('knowledge'), raw, lines, 'm');
    const knowledge = (first!.output as { knowledge: Record<string, Record<string, unknown>[]> }).knowledge;
    expect(knowledge.characters![0]!.evidence).toEqual(['k1']);
    expect(knowledge.relationships![0]).toMatchObject({ at: 'k2', evidence: ['k2'] });
    expect(knowledge.events![0]!.evidence).toEqual(['k2']);
    expect(knowledge.speechRules![0]).toMatchObject({ start: null, evidence: [] });
    expect(second!.output).toEqual({ knowledge: { characters: [], relationships: [], events: [], speechRules: [] }, batchLeader: false });
  });
});
