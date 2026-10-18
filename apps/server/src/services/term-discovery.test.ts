import { describe, expect, it } from 'vitest';
import { discoverTerms } from './term-discovery.ts';

describe('discoverTerms (language-agnostic)', () => {
  it('extracts bracketed and quoted terms across different languages', () => {
    const units = [
      { key: 'u1', source: '勇者は『エクスカリバー』を手に入れた。' },
      { key: 'u2', source: '伝説の剣「エクスカリ버」は眩しく輝いている。' },
      { key: 'u3', source: '다음 임무는 【프로젝트 오메가】를 가동하는 것입니다.' },
      { key: 'u4', source: 'We need to activate "Project Omega" immediately.' },
    ];
    const found = discoverTerms(units, [], { minLines: 1 });
    const sources = found.map((t) => t.source);
    expect(sources).toContain('エクスカリバー');
    expect(sources).toContain('프로젝트 오메가');
    expect(sources).toContain('Project Omega');
  });

  it('extracts katakana terms in Japanese scripts', () => {
    const units = [
      { key: 'u1', source: 'クラウドはミッドガルに向かった。' },
      { key: 'u2', source: 'ミッドガルには神羅カンパニーの本社がある。' },
      { key: 'u3', source: 'セフィロスが再び現れた。' },
    ];
    const found = discoverTerms(units, [], { sourceLanguage: 'ja', minLines: 1 });
    const sources = found.map((t) => t.source);
    expect(sources).toContain('クラウド');
    expect(sources).toContain('ミッドガル');
    expect(sources).toContain('セフィロス');
    expect(sources).toContain('カンパニー');
    const midgar = found.find((t) => t.source === 'ミッドガル');
    expect(midgar?.lines).toBe(2);
    expect(midgar?.examples).toEqual(['u1', 'u2']);
  });

  it('extracts capitalized phrases and acronyms in English scripts', () => {
    const units = [
      { key: 'u1', source: 'Welcome to Westmere Harbor.' },
      { key: 'u2', source: 'The Westmere Harbor security is tight.' },
      { key: 'u3', source: 'The EMP device disabled the drones.' },
      { key: 'u4', source: 'Another EMP blast was detected.' },
    ];
    const found = discoverTerms(units, [], { sourceLanguage: 'en', minLines: 2 });
    const sources = found.map((t) => t.source);
    expect(sources).toContain('Westmere Harbor');
    expect(sources).toContain('EMP');
  });

  it('includes registered characters and aliases with correct kinds', () => {
    const units = [
      { key: 'u1', source: 'Hey Anderson, did you check the panel?' },
      { key: 'u2', source: 'Hank is already there.' },
    ];
    const characters = [{ name: 'Hank', aliases: ['Anderson'] }];
    const found = discoverTerms(units, characters, { minLines: 1 });
    const hank = found.find((t) => t.source.toLowerCase() === 'hank');
    const anderson = found.find((t) => t.source.toLowerCase() === 'anderson');
    expect(hank).toBeDefined();
    expect(hank?.kind).toBe('character');
    expect(anderson).toBeDefined();
    expect(anderson?.kind).toBe('character');
    expect(anderson?.aliasOf).toBe('Hank');
  });

  it('strips placeholders and tags before tokenization', () => {
    const units = [
      { key: 'u1', source: 'Hello {PLAYER_NAME}, welcome to [Sector 7] <color=red>Cyber City</color>.' },
      { key: 'u2', source: 'We must defend Cyber City at all costs.' },
    ];
    const found = discoverTerms(units, [], { minLines: 2 });
    const sources = found.map((t) => t.source);
    expect(sources).not.toContain('{PLAYER_NAME}');
    expect(sources).not.toContain('[Sector 7]');
    expect(sources).toContain('Cyber City');
  });

  it('ignores English function words (For, To, You, With) and sentence-initial common words while extracting proper nouns', () => {
    const units = [
      { key: 'u1', source: 'For the record, Orwell is watching you.' },
      { key: 'u2', source: 'To be honest, you should talk to Orwell with care.' },
      { key: 'u3', source: 'You know that for sure, with or without BNSA.' },
      { key: 'u4', source: 'With time, people forget what BNSA did to you.' },
      { key: 'u5', source: 'Time is running out for you and me.' },
    ];
    const found = discoverTerms(units, [], { sourceLanguage: 'en', minLines: 2 });
    const lowerSources = found.map((t) => t.source.toLowerCase());
    expect(lowerSources).not.toContain('for');
    expect(lowerSources).not.toContain('to');
    expect(lowerSources).not.toContain('you');
    expect(lowerSources).not.toContain('with');
    expect(lowerSources).not.toContain('time');
    expect(found.map((t) => t.source)).toContain('Orwell');
    expect(found.map((t) => t.source)).toContain('BNSA');
  });
});
