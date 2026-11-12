import { describe, expect, it } from 'vitest';
import { exitActionSchema, workflowNodeSchema, withExitActions, type ExitAction, type WorkflowNode } from '@tw/shared';
import { exitActionText, exitKey, exitTagItems, parseExitKey, type MarkNames } from './exit-marks';

const names: MarkNames = {
  tags: new Map([['format', { name: '형식 오류', color: 'red' }], ['term', { name: '용어 오류', color: 'orange' }], ['a', { name: 'A', color: 'blue' }], ['b', { name: 'B', color: 'green' }]]),
  statuses: new Map([['done', { name: '완료', color: 'green' }]]),
};
const tag = (action: 'add' | 'remove', tagIds: string[], fromField?: string): ExitAction => exitActionSchema.parse({ type: 'tag', action, tagIds, fromField });
const status = (statusId: string): ExitAction => ({ type: 'status', statusId });
const nodeWith = (port: string, actions: ExitAction[], id = 'review'): WorkflowNode =>
  withExitActions(workflowNodeSchema.parse({ id, type: 'function', position: { x: 0, y: 0 }, config: { fn: 'saveCandidate', params: {} } }), port, actions);

describe('exitKey and parseExitKey', () => {
  it('joins and splits node id and exit', () => {
    expect(exitKey('review', 'fail')).toBe('review:fail');
    expect(parseExitKey('review:fail')).toEqual({ nodeId: 'review', port: 'fail' });
  });
  it('keeps everything before the last colon as the node id, also with a slash in it', () => {
    expect(parseExitKey('call:1/inner:pass')).toEqual({ nodeId: 'call:1/inner', port: 'pass' });
    expect(parseExitKey(exitKey('c/w1:x', 'error'))).toEqual({ nodeId: 'c/w1:x', port: 'error' });
  });
  it('is undefined without a key, a colon or a node id', () => {
    expect(parseExitKey(undefined)).toBeUndefined();
    expect(parseExitKey('')).toBeUndefined();
    expect(parseExitKey('review')).toBeUndefined();
    expect(parseExitKey(':fail')).toBeUndefined();
  });
});

describe('exitTagItems', () => {
  it('is empty for an exit without actions', () => {
    expect(exitTagItems(nodeWith('fail', [tag('add', ['format'])]), 'pass', names)).toEqual([]);
  });
  it('lists each tag put on or taken off with its name and colour', () => {
    expect(exitTagItems(nodeWith('fail', [tag('add', ['format']), tag('remove', ['term'])]), 'fail', names)).toEqual([
      { kind: 'tag', action: 'add', name: '형식 오류', color: 'red' },
      { kind: 'tag', action: 'remove', name: '용어 오류', color: 'orange' },
    ]);
  });
  it('lists a status by its name and colour', () => {
    expect(exitTagItems(nodeWith('pass', [status('done')]), 'pass', names)).toEqual([{ kind: 'status', name: '완료', color: 'green', statusKind: undefined, inReview: undefined }]);
  });
  it('names a deleted tag or status, and a status not picked yet', () => {
    expect(exitTagItems(nodeWith('error', [tag('add', ['gone']), status('gone')]), 'error', names).map((item) => item.name)).toEqual(['삭제된 태그', '삭제된 상태']);
    expect(exitTagItems(nodeWith('error', [status('')]), 'error', names)[0]?.name).toBe('상태 고르기');
  });
  it('names the tags a result decides by the step whose result it is, with the tags set for its values', () => {
    // A check leaves a result, so its own exits' tags follow it.
    const check = workflowNodeSchema.parse({ id: 'check', type: 'function', label: '형식 검사', position: { x: 0, y: 0 }, config: { fn: 'formatCheck', params: {} } });
    const node = withExitActions(check, 'fail', [exitActionSchema.parse({ type: 'tag', action: 'add', tagIds: [], fromField: 'kind', categoryTags: { format: 'format', term: 'term', other: 'format' } })]);
    expect(exitTagItems(node, 'fail', names, { nodes: [node], edges: [] })).toEqual([{ kind: 'tag', action: 'add', name: '형식 검사', fromResult: true, options: [{ name: '형식 오류', color: 'red' }, { name: '용어 오류', color: 'orange' }] }]);
    expect(exitTagItems(node, 'fail', names)[0]?.name).toBe('이전 단계');
  });
});

describe('exitActionText', () => {
  it('says the tags to add or remove by name, and how many past three', () => {
    expect(exitActionText(tag('add', ['format', 'term']), names)).toBe('추가할 태그 · #형식 오류, #용어 오류');
    expect(exitActionText(tag('remove', ['format', 'term', 'a', 'b']), names)).toBe('제거할 태그 · 4개');
  });
  it('says the tags a result decides by its step, and a deleted tag', () => {
    expect(exitActionText(tag('add', [], 'categories'), names, 'AI 검수')).toBe('추가할 태그 · AI 검수 결과에 따라');
    expect(exitActionText(tag('add', ['gone'], 'categories'), names)).toBe('추가할 태그 · #삭제된 태그, 이전 단계 결과에 따라');
  });
  it('words a status, also a deleted one', () => {
    expect(exitActionText(status('done'), names)).toBe('상태 → 완료');
    expect(exitActionText(status('gone'), names)).toBe('상태 → 삭제된 상태');
  });
  it('words an empty tag action by the action alone', () => {
    expect(exitActionText(tag('add', []))).toBe('추가할 태그');
  });
});

