import { describe, expect, it } from 'vitest';
import { wordDiff } from './diff';

describe('word diff', () => {
  it('marks what a later translation removed and added: Korean by letter, so a changed ending is only that', () => {
    expect(wordDiff('벌써 내 부하 둘을 쐈어', '벌써 내 부하 셋을 쐈어')).toEqual([
      { text: '벌써 내 부하 ' },
      { text: '둘', change: 'removed' },
      { text: '셋', change: 'added' },
      { text: '을 쐈어' },
    ]);
    expect(wordDiff('잠깐만요, 찾아볼게요.', '잠깐, 찾아올게요.').filter((part) => part.change).map((part) => part.text)).toEqual(['만요', '볼', '올']);
  });
  it('compares other text by word', () => {
    expect(wordDiff('Hold on a moment', 'Hold on a second')).toEqual([{ text: 'Hold on a ' }, { text: 'moment', change: 'removed' }, { text: 'second', change: 'added' }]);
  });
  it('gives the new text back from the kept and added parts', () => {
    const after = '그래, 카드 긁어도 뭐라 안 할게.';
    expect(wordDiff('카드 왕창 긁어도 돼.', after).filter((part) => part.change !== 'removed').map((part) => part.text).join('')).toBe(after);
  });
});
