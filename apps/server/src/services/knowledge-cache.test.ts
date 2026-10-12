import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { importFileSchema, lineFilterSchema, mentions } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { buildContext } from './context.ts';
import { contextConfigSchema } from '@tw/shared';
import { checkScript } from './script-query.ts';
import { knowledgeOf, speechRuleIndex } from './speech.ts';

function setup(lines = 3) {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Cache' },
    groups: [{ key: 'g1', title: 'One', section: 'Ch' }, { key: 'g2', title: 'Two', section: 'Ch' }],
    units: Array.from({ length: lines }, (_, i) => ({ key: `l${i}`, group: i < lines / 2 ? 'g1' : 'g2', speaker: 'Alice', listener: 'Bob', source: `Alice meets Bob at line ${i}`, translation: `번역 ${i}` })),
    characters: [{ name: 'Alice', aliases: [] }, { name: 'Bob', aliases: [] }],
  });
  const { projectId } = importProject(db, file);
  return { db, projectId };
}

describe('knowledge snapshot cache', () => {
  it('returns the same object while nothing changed and fresh data after any write', () => {
    const { db, projectId } = setup();
    const first = knowledgeOf(db, projectId).terms();
    expect(knowledgeOf(db, projectId).terms()).toBe(first);
    expect(first.rows).toHaveLength(0);

    db.insert(s.terms).values({ projectId, source: 'Alice', target: '앨리스' }).run();
    const second = knowledgeOf(db, projectId).terms();
    expect(second.rows.map((t) => t.target)).toEqual(['앨리스']);
    expect(second.matcher.find('hi alice')).toHaveLength(1);

    db.update(s.terms).set({ target: '앨리' }).where(eq(s.terms.projectId, projectId)).run();
    expect(knowledgeOf(db, projectId).terms().rows[0].target).toBe('앨리');
    expect(knowledgeOf(db, projectId).glossary().rows[0].target).toBe('앨리');

    db.delete(s.terms).where(eq(s.terms.projectId, projectId)).run();
    expect(knowledgeOf(db, projectId).glossary().rows).toHaveLength(0);
  });

  it('sees relationship edits that carry no updated_at', () => {
    const { db, projectId } = setup();
    const [alice, bob] = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    const rel = db.insert(s.relationships).values({ projectId, fromId: alice.id, toId: bob.id, kind: 'friend' }).returning().get();
    expect(knowledgeOf(db, projectId).relationships()[0].kind).toBe('friend');
    db.update(s.relationships).set({ kind: 'rival' }).where(eq(s.relationships.id, rel.id)).run();
    expect(knowledgeOf(db, projectId).relationships()[0].kind).toBe('rival');
    const context = buildContext(db, projectId, db.select().from(s.units).all().slice(0, 1), contextConfigSchema.parse({ characters: true, relationships: true }));
    expect(context.relationships.map((r) => r.kind)).toEqual(['rival']);
  });

  it('does not keep data from a rolled-back transaction', () => {
    const { db, projectId } = setup();
    expect(knowledgeOf(db, projectId).terms().rows).toHaveLength(0);
    try {
      db.transaction((tx) => {
        tx.insert(s.terms).values({ projectId, source: 'Ghost', target: '유령' }).run();
        expect(knowledgeOf(tx as never, projectId).terms().rows).toHaveLength(1);
        throw new Error('rollback');
      });
    } catch {}
    expect(knowledgeOf(db, projectId).terms().rows).toHaveLength(0);
    // The same happens when the next transaction reads before anything outside one has.
    try {
      db.transaction((tx) => {
        tx.insert(s.terms).values({ projectId, source: 'Ghost', target: '유령' }).run();
        knowledgeOf(tx as never, projectId).terms();
        throw new Error('rollback');
      });
    } catch {}
    db.transaction((tx) => {
      expect(knowledgeOf(tx as never, projectId).terms().rows).toHaveLength(0);
    });
  });

  it('a write inside a transaction is visible to later reads in it', () => {
    const { db, projectId } = setup();
    db.transaction((tx) => {
      expect(knowledgeOf(tx as never, projectId).allTermSources()).toEqual([]);
      tx.insert(s.terms).values({ projectId, source: 'One', target: '하나', status: 'candidate' }).run();
      expect(knowledgeOf(tx as never, projectId).allTermSources()).toEqual(['One']);
    });
    expect(knowledgeOf(db, projectId).allTermSources()).toEqual(['One']);
  });

  it('speech rule index follows rule, character and script-order changes', () => {
    const { db, projectId } = setup(4);
    const line = (key: string) => db.select().from(s.units).where(eq(s.units.key, key)).get()!;
    const resolve = (key: string) => speechRuleIndex(db, projectId).resolve([line(key)]).get(key)?.rule.level;
    expect(resolve('l3')).toBeUndefined();
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'haeyo', startKey: null }).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'hae', startKey: 'l2' }).run();
    expect(resolve('l1')).toBe('haeyo');
    expect(resolve('l3')).toBe('hae');
    // Moving the scene that holds l2 behind the other changes which lines fall after the rule's start.
    const g1 = db.select().from(s.groups).where(eq(s.groups.key, 'g1')).get()!;
    const g2 = db.select().from(s.groups).where(eq(s.groups.key, 'g2')).get()!;
    db.update(s.groups).set({ sort: g2.sort + 10 }).where(eq(s.groups.id, g1.id)).run();
    // Script order is units.seq; a reorder has to renumber it (nothing reorders scenes in the app today).
    db.update(s.units).set({ seq: sql`${s.units.seq} + 100` }).where(eq(s.units.groupId, g1.id)).run();
    expect(resolve('l1')).toBe('hae');
    expect(resolve('l0')).toBe('hae');
    // A new alias makes a different speaker name hit the same pair.
    db.update(s.characters).set({ aliases: ['CHAR_A'] }).where(eq(s.characters.name, 'Alice')).run();
    const aliased = { ...line('l0'), speaker: 'CHAR_A' };
    expect(speechRuleIndex(db, projectId).resolve([aliased]).get('l0')?.rule.level).toBe('hae');
  });
});

describe('checkScript terms speed', () => {
  it('20k lines x 1,000 terms finishes in a few seconds and matches the per-pair result', () => {
    const lineCount = 20_000;
    const termCount = 1_000;
    const db = openDatabase(':memory:');
    const words = Array.from({ length: termCount }, (_, i) => `Term${i}x`);
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'Bench' },
      groups: [{ key: 'g', title: 'All', section: 'S' }],
      units: Array.from({ length: lineCount }, (_, i) => ({ key: `u${i}`, group: 'g', speaker: 'A', source: `Line ${i}: ${words[i % termCount]} and ${words[(i * 7) % termCount].toLowerCase()}, 서울에서 보자.`, translation: i % 3 ? `번역 ${i}` : `번역 ${i} T${i % termCount}` })),
      terms: words.map((source, i) => ({ source, target: `T${i}` })),
    });
    const { projectId } = importProject(db, file);

    const start = performance.now();
    const found = checkScript(db, projectId, 'terms', lineFilterSchema.parse({}));
    const ms = performance.now() - start;
    console.log(`checkScript(terms) ${lineCount} lines x ${termCount} terms: ${ms.toFixed(0)} ms, ${found.length} findings`);
    expect(ms).toBeLessThan(5000);

    // Legacy per-pair evaluation on a slice gives the same findings.
    const terms = db.select().from(s.terms).all();
    const rows = db.select({ key: s.units.key, source: s.units.source, translation: s.units.translation }).from(s.units).limit(300).all();
    const expected = rows.flatMap((row) => terms.filter((t) => mentions(row.source, t.source) && !row.translation!.toLowerCase().includes(t.target.toLowerCase())).map((t) => `${row.key}|${t.source}`));
    const actual = (found as { key: string; term: string }[]).filter((f) => rows.some((r) => r.key === f.key)).map((f) => `${f.key}|${f.term}`);
    expect(actual.sort()).toEqual(expected.sort());
  }, 60_000);
});
