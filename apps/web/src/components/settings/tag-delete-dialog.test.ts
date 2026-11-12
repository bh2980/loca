import { describe, expect, it } from 'vitest';
import { tagDeleteWording } from './tag-delete-dialog';

describe('tagDeleteWording', () => {
  it('names one tag, how many lines lose it, and the workflow nodes to fix', () => {
    expect(tagDeleteWording([{ name: '검수 필요', units: 1234 }])).toEqual({
      title: '“#검수 필요” 태그를 삭제할까요?',
      description: '대사 1,234개에서 이 태그가 제거됩니다. 이 태그를 쓰는 워크플로 노드는 수정해야 합니다.',
    });
  });

  it('counts several tags in the title and gives each its own line count, never a sum', () => {
    const wording = tagDeleteWording([{ name: '검수 필요', units: 12 }, { name: '보류', units: 3 }]);
    expect(wording.title).toBe('태그 2개를 삭제할까요?');
    expect(wording.description).toBe('#검수 필요(대사 12개), #보류(대사 3개)에서 태그가 제거됩니다. 이 태그들을 쓰는 워크플로 노드는 수정해야 합니다.');
    expect(wording.description).not.toContain('15');
  });

  it("says what a tag of the home's defaults means: it has no lines to lose", () => {
    expect(tagDeleteWording([{ name: '보류', units: undefined }]).description).toBe('새로 만드는 프로젝트가 이 태그를 받지 않습니다. 이미 있는 프로젝트는 그대로입니다.');
  });
});
