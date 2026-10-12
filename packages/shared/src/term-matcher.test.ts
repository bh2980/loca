import { describe, expect, it } from 'vitest';
import { mentions, termMatcher } from './format-check.ts';

const names = ['Alice', 'alice grey', 'C++', 'a.b', '(x)', '[tag]', 'ß', 'K', 's', '서울', '수사관', 'O\'Neil', '  padded  ', '', '   ', 'İstanbul', '$1', 'a|b', '\\d'];
const texts = [
  '', 'Hello Alice!', 'ALICE GREY said', 'malice', 'alicex', 'Alice_', 'alice1', '서울에서', '서울역', '수사관님', '그 수사관.', '수사관',
  'C++ is fine', 'xC++', 'a.b and aXb', '(x) here', '[tag] here', 'STRASSE ß', 'ẞ', 'Kelvin K', 'ſ is long s', 'it is', "O'Neil's", 'padded', ' padded ',
  'İstanbul', 'istanbul', 'costs $1.', 'a|b', 'ab', '\\d', '5', 'Alice, Bob', '「Alice」', 'Alice\nGrey',
];

describe('termMatcher', () => {
  it('answers exactly like mentions() for every name/text pair', () => {
    for (const name of names) {
      const matcher = termMatcher([name], (n) => n);
      for (const text of texts) {
        expect(matcher.has(text), `${JSON.stringify(name)} in ${JSON.stringify(text)}`).toBe(mentions(text, name));
        expect(matcher.find(text).length === 1).toBe(mentions(text, name));
      }
    }
  });

  it('keeps the original order and supports several names per item', () => {
    const items = [{ id: 1, n: ['Zed', 'zeddy'] }, { id: 2, n: ['Alice'] }, { id: 3, n: ['  '] }];
    const matcher = termMatcher(items, (item) => item.n);
    expect(matcher.find('alice met ZEDDY').map((item) => item.id)).toEqual([1, 2]);
    expect(matcher.find('malice').map((item) => item.id)).toEqual([]);
  });

  it('respects Korean particles, case and partial words', () => {
    const matcher = termMatcher(['서울', 'Bob'], (n) => n);
    expect(matcher.find('서울에서 만나').length).toBe(0); // a particle makes it part of a longer word, as mentions() says
    expect(matcher.find('서울 에서').length).toBe(1);
    expect(matcher.find('BOB!').length).toBe(1);
    expect(matcher.find('Bobby').length).toBe(0);
  });
});
