import { describe, expect, it } from 'vitest';
import { termExpected, termForModel, termForms, termKept, termLine } from './format-check.ts';

const fixed = { source: 'Relay', target: '중계소', note: '', mode: 'fixed' as const, alternatives: ['릴레이'] };
const choices = { ...fixed, mode: 'choices' as const, alternatives: ['릴레이 기지', ' 중계소 '] };
const guide = { source: 'mate', target: '친구', note: '친근한 호칭, 상황에 맞게', mode: 'guide' as const, alternatives: [] };

describe('what a term asks of a translation', () => {
  it('고정 keeps its one form (alternatives of another kind do not count)', () => {
    expect(termForms(fixed)).toEqual(['중계소']);
    expect(termKept(fixed, '중계소에 왔다')).toBe(true);
    expect(termKept(fixed, '릴레이에 왔다')).toBe(false);
  });

  it('후보 is kept by any of its forms, the main one first, without repeats', () => {
    expect(termForms(choices)).toEqual(['중계소', '릴레이 기지']);
    expect(termKept(choices, '릴레이 기지로 가자')).toBe(true);
    expect(termKept(choices, '기지로 가자')).toBe(false);
    expect(termExpected(choices)).toBe('"중계소" / "릴레이 기지"');
  });

  it('뉘앙스 has no form to keep, so it is never broken', () => {
    expect(termForms(guide)).toEqual([]);
    expect(termKept(guide, '아무 말')).toBe(true);
  });

  it('goes to a model by its kind: a form, forms to pick from, or a sense with an example', () => {
    expect(termForModel(fixed)).toEqual({ source: 'Relay', target: '중계소', note: '' });
    expect(termForModel(choices)).toEqual({ source: 'Relay', target: '중계소', note: '', alternatives: ['릴레이 기지'] });
    expect(termForModel(guide)).toEqual({ source: 'mate', guide: '친근한 호칭, 상황에 맞게', example: '친구' });
  });

  it('reads on one line by its kind', () => {
    expect(termLine(fixed)).toBe('Relay → 중계소');
    expect(termLine(choices)).toBe('Relay → 중계소 / 릴레이 기지 (문맥에 맞게)');
    expect(termLine(guide)).toBe('mate: 뉘앙스 — 친근한 호칭, 상황에 맞게 (예: 친구)');
  });
});
