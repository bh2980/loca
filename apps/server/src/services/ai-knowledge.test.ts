import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { aiSaveCharacters, aiSaveDocument, aiSaveEvents, aiSaveRelationships, aiSaveSpeechRules, aiSaveTerms, aiSetLineListeners, aiSetSceneListeners, canonicalNames } from './ai-knowledge.ts';
import { importProject } from './importer.ts';
import { tagsOf } from './knowledge-tags.ts';

/** Why a rule is marked 확인 권장 (its tag's note), or undefined. */
const reviewOf = (db: Parameters<typeof tagsOf>[0], id: string) => tagsOf(db, 'speechRules', [id]).get(id)?.find((tag) => tag.note)?.note ?? undefined;

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor', section: 'Ch 1' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
      { key: 'a3', group: 'g1', speaker: 'Alice', source: 'Never again.' },
    ],
  });
  const { projectId } = importProject(db, file);
  const write = { projectId, runId: undefined as string | undefined, autoConfirm: true };
  return { db, projectId, write };
}
const lines = (db: ReturnType<typeof setup>['db'], projectId: string) => new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.key, unit]));

describe('AI knowledge writes', () => {
  it('maps fuller names onto stored speakers and leaves ambiguous ones alone', () => {
    const map = canonicalNames(
      [{ name: 'Mara', aliases: ['CHAR_MARA'] }, { name: 'Iris', aliases: [] }, { name: 'Ivy', aliases: [] }],
      [{ name: 'Mara Holt', aliases: ['Mari'] }, { name: 'Iris Vance', aliases: ['Irie'] }, { name: 'Vance family', aliases: [] }, { name: 'Michael', aliases: [] }],
    );
    expect(map.get('mara holt')).toBe('Mara');
    expect(map.get('irie')).toBe('Iris');
    expect(map.get('vance family')).toBeUndefined();
    expect(map.get('michael')).toBeUndefined();
  });

  it('fills the empty fields of a person already in the cast and leaves written ones alone', () => {
    const { db, projectId, write } = setup();
    db.insert(s.characters).values([{ projectId, name: 'Alice', origin: 'import', role: 'unknown', status: 'confirmed' }, { projectId, name: 'Bob', profile: '사람이 쓴 설명', gender: 'unknown', role: 'unknown', origin: 'human', status: 'confirmed' }]).run();
    const counts = aiSaveCharacters(db as never, write, [
      { name: 'Alice', profile: '선장', speech: '짧고 단호함', gender: 'female', ageBand: 'middle', role: 'main' },
      { name: 'Bob', profile: 'AI 설명', gender: 'female', role: 'supporting' },
      { name: 'Guard', role: 'minor', gender: 'bogus', evidence: ['a2'] },
    ]);
    expect(counts).toEqual({ added: 1, filled: 1 });
    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    expect(people.get('Alice')).toMatchObject({ profile: '선장', speech: '짧고 단호함', gender: 'female', role: 'main', origin: 'import' });
    // A person's character: its written profile stays, and its 'unknown' is the person's answer.
    expect(people.get('Bob')).toMatchObject({ profile: '사람이 쓴 설명', gender: 'unknown', role: 'unknown' });
    expect(people.get('Guard')).toMatchObject({ role: 'minor', gender: 'unknown', origin: 'ai', statusBy: 'ai', status: 'confirmed', evidence: ['a2'] });
  });

  it('writes AI candidates under the candidate switch', () => {
    const { db, projectId, write } = setup();
    aiSaveCharacters(db as never, { ...write, autoConfirm: false }, [{ name: 'Guard' }]);
    expect(db.select().from(s.characters).where(eq(s.characters.name, 'Guard')).get()).toMatchObject({ status: 'candidate', origin: 'ai' });
    expect(projectId).toBeTruthy();
  });

  it('adds terms, fills only empty forms of terms already there and leaves rejected ones', () => {
    const { db, projectId, write } = setup();
    db.insert(s.terms).values([{ projectId, source: 'Alice', target: '', note: '', status: 'candidate', origin: 'script' }, { projectId, source: 'cut', target: '', status: 'rejected', statusBy: 'human' }]).run();
    const counts = aiSaveTerms(db as never, { ...write, runId: undefined }, [
      { source: 'boss', kind: 'title', meaning: '선원들이 선장을 부르는 말', target: '선장님', evidence: ['a2'] },
      { source: 'alice', target: '앨리스' },
      { source: 'Cut', target: '자르기' },
    ]);
    expect(counts).toMatchObject({ added: 1, filled: 1, unchanged: 1 });
    expect(db.select().from(s.terms).where(eq(s.terms.source, 'boss')).get()).toMatchObject({ target: '선장님', note: '호칭·직함 · 선원들이 선장을 부르는 말', status: 'confirmed', origin: 'ai', examples: ['a2'] });
    expect(db.select().from(s.terms).where(eq(s.terms.source, 'Alice')).get()).toMatchObject({ target: '앨리스', origin: 'script' });
    expect(db.select().from(s.terms).where(eq(s.terms.source, 'cut')).get()).toMatchObject({ target: '', status: 'rejected' });
  });

  it('adds relationships between stored people, changes only an unchecked AI one and keeps a person\'s beside a candidate', () => {
    const { db, projectId, write } = setup();
    aiSaveCharacters(db as never, write, [{ name: 'Alice' }, { name: 'Bob' }]);
    const rel = { from: 'Bob', to: 'Alice', kind: '부하', description: '', changes: [{ at: 'a3', change: '긴장', cause: '지각' }], evidence: ['a2'] };
    expect(aiSaveRelationships(db as never, write, [rel, { from: 'Nobody', to: 'Alice', kind: 'x' }])).toMatchObject({ added: 1, unresolved: ['Nobody → Alice'] });
    // An unchecked AI relationship gains a new change.
    aiSaveRelationships(db as never, write, [{ ...rel, changes: [{ at: 'a1', change: '풀림' }] }]);
    expect(db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all().map((r) => r.changes.length)).toEqual([2]);
    // Once a person confirmed it, a new change waits as a candidate beside it.
    db.update(s.relationships).set({ statusBy: 'human' }).where(eq(s.relationships.projectId, projectId)).run();
    const result = aiSaveRelationships(db as never, write, [{ ...rel, changes: [{ at: 'a2', change: '화해' }] }]);
    expect(result.proposed).toBe(1);
    const all = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.status === 'candidate')?.description).toContain('변경 제안');
  });

  it('does not add a rejected rule again, doubts a rule whose evidence is someone else talking and yields to a person\'s rule', () => {
    const { db, projectId, write } = setup();
    const rule = { fromName: 'Bob', toName: 'Alice', level: 'hasipsio', address: '선장님', evidence: ['a2'] };
    aiSaveSpeechRules(db as never, write, [rule]);
    db.update(s.speechRules).set({ status: 'rejected', statusBy: 'human' }).where(eq(s.speechRules.fromName, 'Bob')).run();
    const counts = aiSaveSpeechRules(db as never, write, [rule, { fromName: 'Bob', toName: 'Alice', level: 'hae', startKey: 'a3', evidence: ['a1', 'a3'] }, { fromName: 'Bob', toName: 'Alice', level: 'nope' }]);
    expect(counts.skipped).toHaveLength(1);
    const bob = db.select().from(s.speechRules).where(eq(s.speechRules.fromName, 'Bob')).all();
    expect(bob.filter((r) => r.level === 'hasipsio').map((r) => r.status)).toEqual(['rejected']);
    const doubtful = bob.find((r) => r.level === 'hae')!;
    expect(doubtful.status).toBe('confirmed');
    expect(reviewOf(db, doubtful.id)).toContain('근거 대사의 화자가 다름');
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'hae', startKey: null, status: 'confirmed', statusBy: 'human' }).run();
    aiSaveSpeechRules(db as never, write, [{ fromName: 'Alice', toName: 'Bob', level: 'hasipsio' }]);
    const ai = db.select().from(s.speechRules).where(eq(s.speechRules.fromName, 'Alice')).all().find((r) => r.level === 'hasipsio')!;
    expect(ai.status).toBe('candidate');
    expect(reviewOf(db, ai.id)).toContain('정식 규칙');
  });

  it('keeps one event per title and rewrites only an untouched AI document', () => {
    const { db, projectId, write } = setup();
    expect(aiSaveEvents(db as never, write, [{ title: '지각' }, { title: '지각' }, { title: '화해' }])).toEqual({ added: 2 });
    expect(aiSaveEvents(db as never, write, [{ title: '지각' }])).toEqual({ added: 0 });
    expect(aiSaveDocument(db as never, write, { title: '개요', body: '1' })).toBe('added');
    expect(aiSaveDocument(db as never, write, { title: '개요', body: '2' })).toBe('replaced');
    db.update(s.documents).set({ statusBy: 'human' }).where(eq(s.documents.projectId, projectId)).run();
    expect(aiSaveDocument(db as never, write, { title: '개요', body: '3' })).toBe('kept');
    expect(db.select().from(s.documents).get()?.body).toBe('2');
  });

  it('sets AI listeners without touching a person\'s or the import\'s, and scene listeners as scene guesses', () => {
    const { db, projectId } = setup();
    db.update(s.units).set({ listener: 'Captain', listenerOrigin: 'import' }).where(eq(s.units.key, 'a3')).run();
    db.update(s.units).set({ listener: 'Guard', listenerOrigin: 'human' }).where(eq(s.units.key, 'a2')).run();
    const result = aiSetLineListeners(db as never, projectId, [{ key: 'a1', listener: 'Bob', confidence: 0.9 }, { key: 'a2', listener: 'Alice' }, { key: 'a3', listener: 'Bob' }, { key: 'zz', listener: 'Bob' }]);
    expect(result.set).toBe(1);
    expect(result.skipped.map((entry) => entry.key)).toEqual(['a2', 'a3', 'zz']);
    expect(lines(db, projectId).get('a1')).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.9 });
    const scene = aiSetSceneListeners(db as never, projectId, [{ scene: 'g1', speaker: 'Alice', listener: 'Bob', confidence: 0.95, exceptions: [{ line: 'a1', listener: 'Crowd', confidence: 0.4 }] }]);
    const after = lines(db, projectId);
    // The per-line AI guess stays over the scene default (the exception then replaces it); the import stays.
    expect(after.get('a3')).toMatchObject({ listener: 'Captain', listenerOrigin: 'import' });
    expect(after.get('a1')).toMatchObject({ listener: 'Crowd', listenerOrigin: 'ai' });
    expect(scene.changed).toBe(1);
  });
});
