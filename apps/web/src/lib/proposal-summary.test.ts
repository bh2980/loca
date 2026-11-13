import { describe, expect, it } from 'vitest';
import { detailsSummary } from './proposal-summary';

describe('detailsSummary', () => {
  it('summarizes single and multi-item changes with line diff stats and node lists', () => {
    expect(
      detailsSummary([
        {
          kind: 'changes',
          items: [{ title: '수정 · 인물 · Alice', changes: [{ field: '프로필', before: 'old', after: 'new' }] }],
        },
      ]),
    ).toBe('1곳 바뀜 · +1 −1줄');

    expect(
      detailsSummary([
        {
          kind: 'changes',
          items: [
            { title: '노드 1', changes: [{ field: '설정 › 지시문', before: 'a\nb\n', after: 'a\nc\nd\n' }] },
            { title: '노드 2', changes: [{ field: '이름', after: '새 이름' }, { field: '설명', after: '설명' }] },
          ],
        },
        { kind: 'list', title: '추가할 노드', items: ['n1 (ai)', 'n2 (function)'] },
        { kind: 'list', title: '삭제할 노드', items: ['n0'] },
      ]),
    ).toBe('항목 2개 · 3곳 바뀜 · +2 −1줄 · 노드 +2 −1');
  });

  it('handles changes without before, empty changes, lines, lists, and fallback', () => {
    expect(
      detailsSummary([
        { kind: 'changes', items: [{ title: '추가 · 인물 · Bob', changes: [{ field: '이름', after: 'Bob' }] }] },
      ]),
    ).toBe('1곳 바뀜');

    expect(detailsSummary([{ kind: 'changes', items: [{ title: '프로젝트 설정', changes: [] }] }])).toBe('바뀌는 내용 없음');

    expect(
      detailsSummary([{ kind: 'lines', total: 1200, translations: 600, statuses: 600, tagged: 0, shown: [] }]),
    ).toBe('대사 1,200개');

    expect(detailsSummary([{ kind: 'list', title: '용어', items: ['a', 'b'], more: 10 }])).toBe('12개');

    expect(detailsSummary([{ kind: 'fields', rows: [{ label: '삭제', value: '3개' }] }])).toBeNull();
  });
});
