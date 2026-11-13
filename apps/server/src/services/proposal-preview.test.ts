import { describe, expect, it } from 'vitest';
import { objectChanges, undoInput, workflowChanges } from './proposal-preview.ts';

describe('objectChanges', () => {
  it('lists only changed nested paths with Korean labels and before/after when known', () => {
    const before = {
      presets: ['newline', 'brace'],
      custom: [{ label: '태그', pattern: '<[^>]+>' }],
      unchanged: 'same',
    };
    const after = {
      presets: ['newline', 'brace', 'percent'],
      custom: [{ label: '새 태그', pattern: '<[^>]+>' }],
      unchanged: 'same',
    };

    expect(objectChanges('서식 규칙', before, after, true)).toEqual([
      { field: '서식 규칙 › 프리셋', before: 'newline, brace', after: 'newline, brace, percent' },
      { field: '서식 규칙 › 직접 만든 규칙 › 1 › 이름', before: '태그', after: '새 태그' },
    ]);
  });

  it('omits before when known is false', () => {
    expect(objectChanges('편집기 AI', undefined, { model: 'gpt-5', connectionId: 'c1' }, false)).toEqual([
      { field: '편집기 AI › 모델', after: 'gpt-5' },
      { field: '편집기 AI › 연결', after: 'c1' },
    ]);
  });
});

describe('workflowChanges', () => {
  const baseDef = {
    nodes: [
      { id: 'n1', type: 'entry', label: '시작' },
      { id: 'n2', type: 'ai', label: '초벌 번역', config: { instructions: '자연스럽게 번역하세요.', model: 'm1' } },
      { id: 'n3', type: 'condition', label: '점검', config: { expression: 'ok' } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  };

  it('shows changed node instructions with field 설정 › 지시문 and before/after', () => {
    const details = workflowChanges(
      { name: '번역', description: '', definition: baseDef },
      {
        name: '번역',
        description: '',
        definition: {
          ...baseDef,
          nodes: [
            baseDef.nodes[0]!,
            { id: 'n2', type: 'ai', label: '초벌 번역', config: { instructions: '직역 위주로 번역하세요.', model: 'm1' } },
            baseDef.nodes[2]!,
          ],
        },
      },
    );

    expect(details).toEqual([
      {
        kind: 'changes',
        items: [
          {
            title: '노드 수정 · 초벌 번역',
            changes: [{ field: '설정 › 지시문', before: '자연스럽게 번역하세요.', after: '직역 위주로 번역하세요.' }],
          },
        ],
      },
    ]);
  });

  it('lists added and removed nodes and summarizes edge changes', () => {
    const details = workflowChanges(
      { name: '번역', description: '', definition: baseDef },
      {
        name: '번역',
        description: '',
        definition: {
          nodes: [
            baseDef.nodes[0]!,
            baseDef.nodes[1]!,
            { id: 'n4', type: 'function', label: '서식 검사', config: { code: 'return true' } },
          ],
          edges: [
            { id: 'e1', source: 'n1', target: 'n2' },
            { id: 'e3', source: 'n2', target: 'n4' },
          ],
        },
      },
    );

    expect(details).toEqual([
      { kind: 'list', title: '추가할 노드', items: ['서식 검사 (function)'] },
      { kind: 'list', title: '삭제할 노드', items: ['점검'] },
      { kind: 'fields', rows: [{ label: '연결', value: '2 → 2개 (추가 1 · 삭제 1)' }] },
    ]);
  });

  it('returns a remark when nothing changed', () => {
    expect(workflowChanges({ name: '번역', description: '', definition: baseDef }, { name: '번역', description: '', definition: baseDef })).toEqual([
      { kind: 'note', tone: 'muted', text: '바뀌는 내용이 없습니다.' },
    ]);
  });
});

describe('undoInput', () => {
  it('returns the input of the first matching undo call or undefined', () => {
    expect(
      undoInput({
        tool: 'save_workflow',
        status: 'accepted',
        undo: { calls: [{ tool: 'other', input: { x: 1 } }, { tool: 'save_workflow', input: { id: 'w1', name: 'Old' } }] },
        report: null,
      }),
    ).toEqual({ id: 'w1', name: 'Old' });

    expect(undoInput({ tool: 'save_workflow', status: 'accepted', undo: null, report: null })).toBeUndefined();
    expect(undoInput({ tool: 'save_workflow', status: 'accepted', undo: { none: 'no' }, report: null })).toBeUndefined();
  });
});
