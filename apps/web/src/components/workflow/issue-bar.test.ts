import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@tw/shared';
import { issueRows } from './issue-bar';

const node = (id: string, label: string) => ({ id, label, type: 'ai', config: {}, position: { x: 0, y: 0 } }) as unknown as WorkflowNode;

describe('workflow issue rows', () => {
  it('folds one error on several nodes into a row that fixes the first', () => {
    const nodes = [node('a', 'AI 번역'), node('b', 'AI 검수'), node('c', 'AI 수정')];
    const rows = issueRows([
      { level: 'error', message: 'AI 연결과 모델을 고르세요.', nodeId: 'a' },
      { level: 'error', message: 'AI 연결과 모델을 고르세요.', nodeId: 'b' },
      { level: 'warning', message: '쓰지 않는 출구', nodeId: 'c' },
      { level: 'error', message: '시작 노드가 없습니다.' },
    ], nodes);
    expect(rows).toEqual([
      { message: 'AI 번역 외 1개 노드: AI 연결과 모델을 고르세요.', nodeId: 'a' },
      { message: '시작 노드가 없습니다.', nodeId: undefined },
    ]);
  });
});
