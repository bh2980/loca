import { describe, expect, it } from 'vitest';
import { statusDeleteWording } from './status-table';

const status = (name: string, units?: number) => ({ id: name, name, color: '', kind: 'normal' as const, inReview: false, units });

describe('statusDeleteWording', () => {
  it("a project's status says how many lines move to another status", () => {
    expect(statusDeleteWording([status('초벌', 1234)])).toEqual({
      title: '“초벌” 상태를 삭제할까요?',
      description: '이 상태의 대사 1,234개를 다른 상태로 옮깁니다. 지운 상태를 쓰는 워크플로 노드는 검증에 실패하므로 수정해야 합니다.',
    });
  });

  it('several statuses are counted in the title, named, and their lines summed (a line is in one status)', () => {
    const wording = statusDeleteWording([status('초벌', 10), status('검수', 5)]);
    expect(wording.title).toBe('상태 2개를 삭제할까요?');
    expect(wording.description).toContain('초벌, 검수의 대사 15개를 다른 상태로 옮깁니다.');
  });

  it("a status of the home's defaults has no lines to move: only new projects are told", () => {
    expect(statusDeleteWording([status('초벌')])).toEqual({ title: '“초벌” 상태를 기본값에서 지울까요?', description: '새로 만드는 프로젝트가 이 상태를 받지 않습니다. 이미 있는 프로젝트는 그대로입니다.' });
    expect(statusDeleteWording([status('초벌'), status('검수')]).title).toBe('상태 2개를 기본값에서 지울까요?');
  });
});
