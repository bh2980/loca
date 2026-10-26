import { describe, expect, it } from 'vitest';
import { talkingPairs, type PairLine } from './talking-pairs.ts';

const line = (speaker: string | null, listener?: string | null, groupId = 'g1'): PairLine => ({ groupId, speaker, listener });

describe('talkingPairs', () => {
  it('counts speaker → listener lines, both directions into one sorted pair', () => {
    const pairs = talkingPairs([line('MIRA', 'JONAS'), line('JONAS', 'MIRA'), line('MIRA', 'JONAS'), line('JONAS', 'KAI')]);
    expect(pairs).toEqual([
      { a: 'JONAS', b: 'MIRA', turns: 3 },
      { a: 'JONAS', b: 'KAI', turns: 1 },
    ]);
  });

  it('without a listener counts the line right before it when another person said it in the same scene', () => {
    const pairs = talkingPairs([line('MIRA'), line('JONAS'), line('JONAS'), line('MIRA'), line('KAI', null, 'g2'), line('MIRA', null, 'g2')]);
    expect(pairs).toEqual([
      { a: 'JONAS', b: 'MIRA', turns: 2 },
      { a: 'KAI', b: 'MIRA', turns: 1 },
    ]);
  });

  it('never pairs across scenes, skips lines nobody says, and ignores special listeners and unknown ones', () => {
    expect(talkingPairs([line('MIRA', null, 'g1'), line('JONAS', null, 'g2')])).toEqual([]);
    // Narration between two spoken lines does not break them apart.
    expect(talkingPairs([line('MIRA'), line(null), line('JONAS')])).toEqual([{ a: 'JONAS', b: 'MIRA', turns: 1 }]);
    // A listener that names nobody counts nothing, and does not fall back to adjacency; "unknown" is no listener.
    expect(talkingPairs([line('MIRA'), line('JONAS', 'group'), line('KAI', 'self'), line('MIRA', 'others')])).toEqual([]);
    expect(talkingPairs([line('MIRA'), line('JONAS', 'unknown')])).toEqual([{ a: 'JONAS', b: 'MIRA', turns: 1 }]);
  });

  it('matches names ignoring case, shows the first spelling, drops self-talk and applies minTurns', () => {
    const lines = [line('Mira', 'Jonas'), line('JONAS', 'MIRA'), line('Mira', 'mira'), line('Kai', 'Mira')];
    expect(talkingPairs(lines)).toEqual([
      { a: 'Jonas', b: 'Mira', turns: 2 },
      { a: 'Kai', b: 'Mira', turns: 1 },
    ]);
    expect(talkingPairs(lines, 2)).toEqual([{ a: 'Jonas', b: 'Mira', turns: 2 }]);
    expect(talkingPairs(lines, 3)).toEqual([]);
  });

  it('counts a line with a listener by the listener and one without by adjacency, each line once', () => {
    // KAI→MIRA is counted by KAI's listener; MIRA's reply has none and counts with the line before it: two turns for one exchange.
    expect(talkingPairs([line('KAI', 'MIRA'), line('MIRA')])).toEqual([{ a: 'KAI', b: 'MIRA', turns: 2 }]);
  });
});
