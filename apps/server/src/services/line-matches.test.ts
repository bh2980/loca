import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { lineMatches } from './line-matches.ts';

function setup(sources: [string, string | null][]) {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'P' },
    groups: [{ key: 'g', title: 'G' }],
    units: sources.map(([source, translation], n) => ({ key: `u${n}`, group: 'g', source, ...(translation && { translation }) })),
  });
  const { projectId } = importProject(db, file, null as never);
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  return { db, units };
}

describe('line matches (the project as its own translation memory)', () => {
  it('finds the same source despite case, punctuation and format tokens, and scores near lines by words', () => {
    const { db, units } = setup([
      ['It already shot down two of my men...', null],
      ['it already shot down TWO of my men', '벌써 내 부하 둘을 쐈어'],
      ['It shot down three of my men.', '내 부하 셋을 쐈어'],
      ['Completely different words here today', '전혀 다른 말'],
      ['It already shot down two of my men...', null],
    ]);
    const matches = lineMatches(db, units[0]);
    expect(matches.map((match) => [match.translation, match.score])).toEqual([
      ['벌써 내 부하 둘을 쐈어', 100],
      ['내 부하 셋을 쐈어', 75],
    ]);
    expect(matches[1].diff?.filter((word) => word.changed).map((word) => word.text)).toEqual(['three']);
  });

  it('matches short lines the trigram index cannot search', () => {
    const { db, units } = setup([['What?', null], ['what!', '뭐?'], ['Whatever', '아무거나']]);
    expect(lineMatches(db, units[0]).map((match) => match.translation)).toEqual(['뭐?']);
  });

  it('treats a format token as one word whatever it holds', () => {
    const { db, units } = setup([['Hello {name}!', null], ['hello {player}', '안녕 {player}']]);
    expect(lineMatches(db, units[0])[0]?.score).toBe(100);
  });
});
