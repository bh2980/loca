import { describe, expect, it } from 'vitest';
import { applyInserts, placeTags } from './tag-placement';

const pattern = /<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>|\{[^{}\r\n]+\}/gu;
const place = (source: string, translation: string, terms: { source: string; target: string }[] = []) => {
  const result = placeTags(source, translation, pattern, terms);
  return { text: applyInserts(translation, result.inserts), left: result.left };
};

describe('placing missing tags by rule', () => {
  it('wraps the whole translation when the source is wholly wrapped, end punctuation kept outside', () => {
    expect(place('<m>Damn it</m>!', '젠장!').text).toBe('<m>젠장</m>!');
    expect(place('<d target="x">I took the card.</d>', '내가 카드 가져갔어.').text).toBe('<d target="x">내가 카드 가져갔어.</d>');
  });
  it('puts a token from the start or end of the source at the start or end', () => {
    expect(place('{icon} Ready', '준비 완료').text).toBe('{icon}준비 완료');
    expect(place('Score: {n}', '점수:').text).toBe('점수:{n}');
  });
  it('wraps a term translation or text repeated verbatim', () => {
    expect(place('Ask <b>Nina</b> later', '나중에 니나한테 물어봐', [{ source: 'Nina', target: '니나' }]).text).toBe('나중에 <b>니나</b>한테 물어봐');
    expect(place('Call <b>555-0199</b> now', '지금 555-0199로 전화해').text).toBe('지금 <b>555-0199</b>로 전화해');
  });
  it('leaves what no rule can place, and never touches what is already there', () => {
    expect(place('You can go <m>fuck</m> yourself.', '나가 뒈지세요.')).toEqual({ text: '나가 뒈지세요.', left: [1] });
    expect(place('<m>Damn</m>', '<m>젠장</m>')).toEqual({ text: '<m>젠장</m>', left: [] });
  });
});
