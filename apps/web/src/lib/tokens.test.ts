import { describe, expect, it } from 'vitest';
import { chipLabel, numberTokens, tokenUnits } from './tokens';

const pattern = /<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>|\{[^{}\r\n]+\}/gu;
const labels = (text: string, source: string) => numberTokens(text, source, pattern).map((token) => chipLabel(token.kind, token.number));

describe('token chips (one number per pair)', () => {
  it('numbers a pair once and a lone token on its own, in source order', () => {
    const source = '<m>Damn.</m> {name} <b>hi</b>';
    expect(labels(source, source)).toEqual(['⟨1', '1⟩', '⟨2⟩', '⟨3', '3⟩']);
    expect(tokenUnits(source, pattern)).toEqual([
      { number: 1, open: '<m>', close: '</m>' },
      { number: 2, open: '{name}' },
      { number: 3, open: '<b>', close: '</b>' },
    ]);
  });
  it('a translation takes the source numbers whatever its order, ? for what the source lacks', () => {
    const source = '<m>Damn.</m> {name}';
    expect(labels('{name}, <m>씨발.</m> <i>x</i>', source)).toEqual(['⟨2⟩', '⟨1', '1⟩', '⟨?', '?⟩']);
  });
  it('an opener without its closer is a lone token', () => {
    expect(labels('<br>line', '<br>line')).toEqual(['⟨1⟩']);
  });
});
