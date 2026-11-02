import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from './index.ts';

const node = (id: string, type: string, config: object = {}) => ({ id, type, position: { x: 0, y: 0 }, config });
const tag = (id: string, action: 'add' | 'remove', tagIds: string[], from?: string) => node(id, 'function', { fn: 'tagLines', params: { list: '', map: from ? { tag: from } : {}, action, tagIds, categoryTags: from ? { format: 't-format' } : {} } });
const status = (id: string, statusId: string, addTagIds: string[] = []) => node(id, 'function', { fn: 'setStatus', params: { statusId, addTagIds, removeTagIds: [] } });
const edge = (source: string, sourceHandle: string, target: string) => ({ id: `${source}-${sourceHandle}-${target}`, source, sourceHandle, target });

describe('0122: 태그·상태 nodes become exit actions', () => {
  const definition = {
    nodes: [
      node('entry', 'entry'),
      node('check', 'function', { fn: 'formatCheck', params: {} }),
      tag('untag', 'remove', ['t-format']),
      tag('tag', 'add', ['t-format']),
      node('review', 'ai'),
      tag('tag-review', 'add', [], 'categories'),
      tag('untag-all', 'remove', ['t-format', 't-term']),
      status('confirm', 's-done'),
      node('next', 'ai'),
      status('needs-review', 's-review', ['t-flag']),
      node('split', 'condition', { expression: true }),
      tag('one-way', 'add', ['t-term']),
      node('other-way', 'ai'),
    ],
    edges: [
      edge('entry', 'out', 'check'),
      edge('check', 'pass', 'untag'),
      edge('untag', 'out', 'review'),
      edge('check', 'fail', 'tag'),
      edge('tag', 'out', 'split'),
      edge('review', 'pass', 'untag-all'),
      edge('untag-all', 'out', 'confirm'),
      edge('confirm', 'out', 'next'),
      edge('review', 'fail', 'tag-review'),
      edge('tag-review', 'out', 'needs-review'),
      edge('review', 'error', 'needs-review'),
      edge('tag-review', 'error', 'next'),
      edge('split', 'true', 'one-way'),
      edge('split', 'true', 'other-way'),
      edge('one-way', 'out', 'next'),
    ],
    settings: { maxVisitsPerNode: 5, maxConsecutiveFailures: 3 },
    groups: [{ id: 'checks', label: '자동 검사', nodeIds: ['check', 'untag', 'tag'] }],
  };
  const db = openDatabase(':memory:');
  const row = db.$client.prepare('select exit_actions(?) as value').get(JSON.stringify(definition)) as { value: string };
  const after = workflowDefinitionSchema.parse(JSON.parse(row.value));
  const exits = (id: string) => after.nodes.find((item) => item.id === id)?.exits;
  const targets = (id: string, port: string) => after.edges.filter((item) => item.source === id && item.sourceHandle === port).map((item) => item.target).sort();

  it('leaves only the nodes that do work, and takes the others out of their frames', () => {
    expect(after.nodes.map((item) => item.id)).toEqual(['entry', 'check', 'review', 'next', 'split', 'other-way']);
    expect(after.groups).toEqual([{ id: 'checks', label: '자동 검사', nodeIds: ['check'] }]);
  });

  it('puts each node\'s work on the exits that led to it, in the order they ran, and leads those exits on', () => {
    expect(exits('check')).toEqual({
      pass: [{ type: 'tag', action: 'remove', tagIds: ['t-format'], categoryTags: {} }],
      fail: [{ type: 'tag', action: 'add', tagIds: ['t-format'], categoryTags: {} }],
    });
    expect(targets('check', 'pass')).toEqual(['review']);
    expect(targets('check', 'fail')).toEqual(['split']);
    // A run of them adds up: 문제 태그 떼기, then 완료.
    expect(exits('review')?.pass).toEqual([{ type: 'tag', action: 'remove', tagIds: ['t-format', 't-term'], categoryTags: {} }, { type: 'status', statusId: 's-done' }]);
    expect(targets('review', 'pass')).toEqual(['next']);
  });

  it('reads tag names from a result field, splits 상태 변경 into a status and tags, and ends an exit with nowhere to go', () => {
    expect(exits('review')?.fail).toEqual([
      { type: 'tag', action: 'add', tagIds: [], fromField: 'categories', categoryTags: { format: 't-format' } },
      { type: 'status', statusId: 's-review' },
      { type: 'tag', action: 'add', tagIds: ['t-flag'], categoryTags: {} },
    ]);
    expect(exits('review')?.error).toEqual([{ type: 'status', statusId: 's-review' }, { type: 'tag', action: 'add', tagIds: ['t-flag'], categoryTags: {} }]);
    expect(targets('review', 'fail')).toEqual([]);
    expect(targets('review', 'error')).toEqual([]);
    // A tag node's 오류 line goes with it.
    expect(after.edges.some((item) => item.source === 'review' && item.target === 'next' && item.sourceHandle === 'fail')).toBe(false);
  });

  it('puts a node on one of an exit\'s split lines on the whole exit (the rule now: once, before the lines split)', () => {
    expect(exits('split')?.true).toEqual([{ type: 'tag', action: 'add', tagIds: ['t-term'], categoryTags: {} }]);
    expect(targets('split', 'true')).toEqual(['next', 'other-way']);
  });

  it('sends a line waiting at such a node on to the first other node, or nowhere', () => {
    const next = (nodeId: string) => (db.$client.prepare('select exit_action_next(?, ?) as value').get(JSON.stringify(definition), nodeId) as { value: string }).value;
    expect(next('untag-all')).toBe('next');
    expect(next('untag')).toBe('review');
    expect(next('needs-review')).toBe('');
    expect(next('review')).toBe('review');
  });

  it('leaves a definition without them as it is', () => {
    const plain = { nodes: [node('entry', 'entry')], edges: [] };
    expect((db.$client.prepare('select exit_actions(?) as value').get(JSON.stringify(plain)) as { value: string }).value).toBe(JSON.stringify(plain));
  });
});
