import { describe, expect, it } from 'vitest';
import { discoverTerms } from './term-discovery.ts';

const lines = (...sources: string[]) => sources.map((source, index) => ({ key: `k${index}`, source }));
const found = (...sources: string[]) => discoverTerms(lines(...sources)).map((term) => term.source);

describe('discoverTerms', () => {
  it('finds capitalized names used mid-sentence in at least two lines, with counts and examples', () => {
    const terms = discoverTerms(lines('We met at Freedom Plaza today.', 'Was Freedom Plaza safe?', 'Freedom Plaza again.'));
    expect(terms).toEqual([{ source: 'Freedom Plaza', lines: 3, kind: 'name', examples: ['k0', 'k1', 'k2'] }]);
  });

  it('keeps a capitalized word that is a name in this game even if it is an English word', () => {
    expect(found("I couldn't keep Thought from going down.", 'She joined Thought last year.')).toEqual(['Thought']);
  });

  it('leaves out ordinary words that only start sentences or are mostly lower case', () => {
    expect(found('Mall security is weak.', 'The mall is closed.', 'Go to the mall now.', 'Mall again?')).toEqual([]);
  });

  it('does not join a sentence opener or "I" to a name', () => {
    expect(found('But Ralph said no.', 'Tell Ralph now.', 'But I know.', 'Well I tried, but I know.')).toEqual(['Ralph']);
  });

  it('drops a leading "The", possessives, shouted words and placeholders, and merges case variants', () => {
    expect(found('Go to The Circle Mall.', 'the Circle Mall is near.', "Thought's blog.", 'I am in Thought.', 'Do NOT go.', 'do not go', '{CHAR_NINA} is here.', '{CHAR_NINA} left.', 'ALICE!', 'Hi, Alice.', 'Bye, Alice.')).toEqual(['Alice', 'Circle Mall', 'Thought']);
  });

  it('keeps acronyms and joins names across "of"', () => {
    expect(found('The NSA called.', 'Ask the NSA.', 'He works at Bank of Westmere.', 'Rob the Bank of Westmere.')).toEqual(['Bank of Westmere', 'NSA']);
  });

  it('adds character names even when the text never spells them out', () => {
    const terms = discoverTerms(lines('{CHAR_NINA} is here.'), [{ name: 'Nina', aliases: ['CHAR_NINA', 'Nin'] }]);
    expect(terms.map(({ source, kind, lines }) => ({ source, kind, lines }))).toEqual([
      { source: 'Nin', kind: 'character', lines: 0 },
      { source: 'Nina', kind: 'character', lines: 0 },
    ]);
  });
});
