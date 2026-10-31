import { describe, expect, it } from 'vitest';
import { buildPairs, knowledgeMatches, pairKey, pairMarks, pairMatches, pairSummary, type KnowledgeItem } from './knowledge-filter.ts';

const item = (over: Partial<KnowledgeItem> = {}): KnowledgeItem => ({ id: 'i', status: 'confirmed', statusBy: 'human', origin: 'human', evidence: ['k1'], reviewNote: '', tags: [], ...over });

describe('knowledgeMatches (the knowledge page and the list tools)', () => {
  it('holds every part given and never lists a rejected item', () => {
    expect(knowledgeMatches(item(), {})).toBe(true);
    expect(knowledgeMatches(item({ status: 'rejected' }), {})).toBe(false);
    expect(knowledgeMatches(item({ origin: 'ai' }), { source: 'workflow' })).toBe(true);
    expect(knowledgeMatches(item(), { source: 'workflow' })).toBe(false);
    expect(knowledgeMatches(item({ status: 'candidate' }), { status: ['candidate', 'confirmed'] })).toBe(true);
    expect(knowledgeMatches(item({ status: 'candidate' }), { status: ['confirmed'] })).toBe(false);
    expect(knowledgeMatches(item({ statusBy: 'ai' }), { decidedBy: 'ai' })).toBe(true);
    expect(knowledgeMatches(item({ status: 'candidate' }), { decidedBy: 'human' })).toBe(false);
    expect(knowledgeMatches(item({ statusBy: 'ai' }), { unreviewed: true })).toBe(true);
    expect(knowledgeMatches(item(), { unreviewed: true })).toBe(false);
  });

  it('reads automatic tags and tags, and 숨기기 leaves out any one of them', () => {
    const marked = item({ evidence: [], reviewNote: '근거 확인', tags: [{ id: 't1' }, { id: 't2' }] });
    expect(knowledgeMatches(marked, { marks: ['review', 'noEvidence'] })).toBe(true);
    expect(knowledgeMatches(item(), { marks: ['review'] })).toBe(false);
    expect(knowledgeMatches(marked, { tags: ['t1', 't2'] })).toBe(true);
    expect(knowledgeMatches(marked, { tags: ['t1', 't3'] })).toBe(false);
    expect(knowledgeMatches(marked, { hideMarks: ['noEvidence'] })).toBe(false);
    expect(knowledgeMatches(marked, { hideTags: ['t3', 't2'] })).toBe(false);
    expect(knowledgeMatches(marked, { hideTags: ['t3'] })).toBe(true);
  });
});

describe('speaker → listener pairs', () => {
  const people = [
    { id: 'm', name: 'Mira', aliases: ['MIRA_01'] },
    { id: 'j', name: 'Jonas', aliases: [] },
  ];
  const rel = { ...item({ id: 'r', tags: [{ id: 't1', note: '갈등' }] }), fromId: 'm', toId: 'j' };
  const rule = (id: string, fromName: string, toName: string, over: Partial<KnowledgeItem> = {}) => ({ ...item({ id, ...over }), fromName, toName });

  it('pairs a relationship with the rules of its direction, rule names read through aliases', () => {
    const pairs = buildPairs(people, [rel], [rule('s1', 'mira_01', 'jonas'), rule('s2', 'Jonas', 'self')]);
    expect(pairs.map((pair) => pair.key)).toEqual([pairKey('Jonas', 'self'), pairKey('Mira', 'Jonas')]);
    const mira = pairs[1];
    expect(mira).toMatchObject({ fromId: 'm', toId: 'j', relationship: rel });
    expect(mira.rules.map((r) => r.id)).toEqual(['s1']);
    expect(pairs[0]).toMatchObject({ fromId: 'j', toId: undefined });
  });

  it('sums up its items and filters through them', () => {
    const [pair] = buildPairs(people, [rel], [rule('s1', 'Mira', 'Jonas', { status: 'candidate', origin: 'ai', evidence: [], tags: [{ id: 't1', note: '말투' }] })]);
    expect(pairSummary(pair)).toMatchObject({ id: pair.key, status: 'candidate', origin: 'ai', statusBy: 'human', tags: [{ id: 't1', note: '갈등\n말투' }] });
    expect(pairMarks(pair)).toEqual(['noEvidence']);
    expect(pairMatches(pair, { status: ['candidate'] })).toBe(true);
    expect(pairMatches(pair, { status: ['confirmed'] })).toBe(false);
    // 출처 and tags through any one item; 숨기기 through any.
    expect(pairMatches(pair, { source: 'workflow' })).toBe(true);
    expect(pairMatches(pair, { source: 'import' })).toBe(false);
    expect(pairMatches(pair, { tags: ['t1'] })).toBe(true);
    expect(pairMatches(pair, { hideMarks: ['noEvidence'] })).toBe(false);
    expect(pairMatches(pair, { hideTags: ['t1'] })).toBe(false);
  });
});
