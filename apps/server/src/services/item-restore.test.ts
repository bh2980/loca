import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { deleteItemsKept, restoreItems } from './item-delete.ts';
import { saveCharacter } from './characters.ts';

describe('graph deletes that ⌘Z puts back', () => {
  it('deletes people with the relationships the cascade takes, and restores both with the same ids, once', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi' }] }));
    const [mira, kai] = db.insert(s.characters).values([{ projectId, name: 'Mira' }, { projectId, name: 'Kai' }]).returning().all();
    const relation = db.insert(s.relationships).values({ projectId, fromId: mira!.id, toId: kai!.id, kind: '동료' }).returning().get();
    const rule = db.insert(s.speechRules).values({ projectId, fromName: 'Mira', toName: 'Kai', level: 'hae' }).returning().get();

    const { token, deleted } = deleteItemsKept(db, projectId, [{ kind: 'characters', ids: [mira!.id] }, { kind: 'speechRules', ids: [rule.id] }]);
    expect(deleted).toBe(3);
    expect(db.select().from(s.relationships).all()).toEqual([]);

    expect(restoreItems(db, projectId, token)).toBe(true);
    expect(db.select().from(s.characters).all().map((row) => row.id).sort()).toEqual([mira!.id, kai!.id].sort());
    expect(db.select().from(s.relationships).all().map((row) => row.id)).toEqual([relation.id]);
    expect(db.select().from(s.speechRules).all().map((row) => row.id)).toEqual([rule.id]);
    // A token works once, and only in its project.
    expect(restoreItems(db, projectId, token)).toBe(false);
    expect(restoreItems(db, 'other', deleteItemsKept(db, projectId, [{ kind: 'speechRules', ids: [rule.id] }]).token)).toBe(false);
  });

  it('takes a deleted person\'s untouched name candidates with it, keeps a touched one, and ⌘Z brings them back', () => {
    const db = openDatabase(':memory:');
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi' }] }));
    const pell = saveCharacter(db, projectId, { name: 'Pell', aliases: ['Captain Pell'] } as never);
    saveCharacter(db, projectId, { name: 'Mira', aliases: [] } as never);
    const sources = () => db.select().from(s.terms).all().map((term) => term.source).sort();
    expect(sources()).toEqual(['Captain Pell', 'Mira', 'Pell']);
    // A person gave "Captain Pell" a translation: it stays.
    db.update(s.terms).set({ target: '펠 선장' }).where(eq(s.terms.source, 'Captain Pell')).run();

    const { token } = deleteItemsKept(db, projectId, [{ kind: 'characters', ids: [pell.id] }]);
    expect(sources()).toEqual(['Captain Pell', 'Mira']);
    expect(restoreItems(db, projectId, token)).toBe(true);
    expect(sources()).toEqual(['Captain Pell', 'Mira', 'Pell']);
  });
});

it('restores tags (including notes) on deleted people, cascaded relationships, and deleted tags on lines', () => {
  const db = openDatabase(':memory:');
  try {
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'u', group: 'g', source: 'Hi' }] }));
    const [a, b] = db.insert(s.characters).values([{ projectId, name: 'A' }, { projectId, name: 'B' }]).returning().all();
    const relation = db.insert(s.relationships).values({ projectId, fromId: a.id, toId: b.id, kind: 'friend' }).returning().get();
    const tag = db.insert(s.tags).values({ projectId, name: 'Keep', color: '#123456' }).returning().get();
    const links = [{ kind: 'characters' as const, itemId: a.id, tagId: tag.id, note: 'reason' }, { kind: 'relationships' as const, itemId: relation.id, tagId: tag.id, note: null }];
    db.insert(s.knowledgeTags).values(links).run();
    const deleted = deleteItemsKept(db, projectId, [{ kind: 'characters', ids: [a.id] }]);
    expect(db.select().from(s.knowledgeTags).all()).toEqual([]);
    expect(restoreItems(db, projectId, deleted.token)).toBe(true);
    expect(db.select().from(s.knowledgeTags).all()).toEqual(links);
    const unitId = db.select().from(s.units).get()!.id;
    db.insert(s.unitTags).values({ unitId, tagId: tag.id }).run();
    const removed = deleteItemsKept(db, projectId, [{ kind: 'tags', ids: [tag.id] }]);
    expect(db.select().from(s.knowledgeTags).all()).toEqual([]);
    expect(db.select().from(s.unitTags).all()).toEqual([]);
    expect(restoreItems(db, projectId, removed.token)).toBe(true);
    expect(db.select().from(s.knowledgeTags).all()).toEqual(links);
    expect(db.select().from(s.unitTags).all()).toEqual([{ unitId, tagId: tag.id }]);
  } finally { db.$client.close(); }
});
