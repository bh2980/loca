import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff';

describe('word diff', () => {
  it('marks the words a later translation removed and added', () => {
    expect(wordDiff('벌써 내 부하 둘을 쐈어', '벌써 내 부하 셋을 쐈어')).toEqual([
      { text: '벌써 내 부하 ' },
      { text: '둘을 ', change: 'removed' },
      { text: '셋을 ', change: 'added' },
      { text: '쐈어' },
    ]);
  });
  it('gives the new text back from the kept and added parts', () => {
    const after = '그래, 카드 긁어도 뭐라 안 할게.';
    expect(wordDiff('카드 왕창 긁어도 돼.', after).filter((part) => part.change !== 'removed').map((part) => part.text).join('')).toBe(after);
  });
});
