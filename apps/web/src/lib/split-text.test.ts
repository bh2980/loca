import { describe, expect, it } from 'vitest';
import { splitBasis, splitTitle } from './split-text';

const base = { requests: 4, mode: 'group', linesTokens: 12_000, budgetBy: 'auto' as const, input: { tokens: null, by: null }, output: { tokens: null, by: null }, connectionName: '코덱스' };

describe('splitTitle', () => {
  it('names the node, the packing and the request count', () => {
    expect(splitTitle('번역', base)).toBe('번역 · 장면별 · 요청 4회 · 한 번에 약 12,000토큰');
  });
  it('leaves the size out when requests are not sized by tokens', () => {
    expect(splitTitle('번역', { ...base, mode: 'unit', linesTokens: null })).not.toContain('한 번에');
  });
});

describe('splitBasis', () => {
  it('gives the node its own number first', () => {
    expect(splitBasis({ ...base, budgetBy: 'node' })).toBe('노드에서 정한 크기입니다.');
  });
  it('points to the connection when no limit is known', () => {
    expect(splitBasis(base)).toBe('연결에 입력·출력 토큰이 없어 기본 크기로 나눕니다.');
  });
  it('names the limits it sized by, each with where it came from', () => {
    expect(splitBasis({ ...base, input: { tokens: 1_000_000, by: 'human' }, output: { tokens: 16_000, by: 'assumed' } })).toBe('입력 1,000,000 (직접 입력) · 출력 16,000 (기본값) 기준입니다.');
    expect(splitBasis({ ...base, output: { tokens: 8_000, by: 'api' } })).toBe('출력 8,000 (모델 정보) 기준입니다.');
  });
});
