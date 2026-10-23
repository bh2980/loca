import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { aiSaveCharacters, aiSaveDocument, aiSaveEvents, aiSaveRelationships, relationshipRows, aiSaveSpeechRules, aiSaveTerms, aiSetLineListeners, canonicalNames } from './ai-knowledge.ts';
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

  it('fills the unknown fields and empty texts of a person already in the cast and leaves written ones alone', () => {
    const { db, projectId, write } = setup();
    db.insert(s.characters).values([{ projectId, name: 'Alice', origin: 'import', role: 'unknown', status: 'confirmed' }, { projectId, name: 'Bob', profile: '사람이 쓴 설명', gender: 'unknown', role: 'unknown', origin: 'human', status: 'confirmed' }]).run();
    const counts = aiSaveCharacters(db as never, write, [
      { name: 'Alice', newFacts: [{ text: '선장', evidence: ['a1'] }], newSpeech: [{ text: '짧고 단호함' }], gender: 'female', ageBand: 'middle', role: 'main' },
      { name: 'Bob', newFacts: [{ text: 'AI 설명' }], gender: 'female', role: 'supporting' },
      { name: 'Guard', role: 'minor', gender: 'bogus', evidence: ['a2'] },
    ]);
    expect(counts).toEqual({ added: 1, filled: 2, appended: 2 });
    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    expect(people.get('Alice')).toMatchObject({ profile: '선장', speech: '짧고 단호함', gender: 'female', role: 'main', origin: 'import', evidence: ['a1'] });
    // A person's character: what is written stays whole (the new fact is appended) and what is still unknown is filled.
    expect(people.get('Bob')).toMatchObject({ profile: '사람이 쓴 설명\nAI 설명', gender: 'female', role: 'supporting' });
    expect(people.get('Guard')).toMatchObject({ role: 'minor', gender: 'unknown', origin: 'ai', statusBy: 'ai', status: 'confirmed', evidence: ['a2'] });
  });

  it('adds the new names of a person in the cast, never one that belongs to another stored person', () => {
    const { db, projectId, write } = setup();
    db.insert(s.characters).values([{ projectId, name: 'Alice', aliases: ['Al'], origin: 'human', statusBy: 'human' }, { projectId, name: 'Bob', aliases: ['Robert'], origin: 'import' }]).run();
    const counts = aiSaveCharacters(db as never, write, [{ name: 'Alice', aliases: ['al', 'Captain', 'Robert', 'Bob'] }]);
    expect(counts).toMatchObject({ added: 0, filled: 1, appended: 0 });
    const people = new Map(db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().map((c) => [c.name, c]));
    expect(people.get('Alice')?.aliases).toEqual(['Al', 'Captain']);
    expect(people.get('Bob')?.aliases).toEqual(['Robert']);
    expect(db.select().from(s.characters).all()).toHaveLength(2);
  });

  describe('new facts of people already there', () => {
    const fact = (text: string, ...evidence: string[]) => ({ text, evidence });
    const stored = (db: ReturnType<typeof setup>['db']) => new Map(db.select().from(s.characters).all().map((c) => [c.name, c]));

    it('appends each new fact on its own line to a human, imported or AI text and leaves the stored text exactly as it is', () => {
      const { db, projectId, write } = setup();
      db.insert(s.characters).values([
        { projectId, name: 'Alice', profile: '사람이 쓴 프로필\n  - 들여쓴 줄', speech: '반말', origin: 'human', statusBy: 'human', status: 'confirmed' },
        { projectId, name: 'Bob', profile: '가져온 프로필', origin: 'import' },
        { projectId, name: 'Cara', profile: 'AI 프로필', origin: 'ai', statusBy: 'ai' },
      ]).run();
      const counts = aiSaveCharacters(db as never, write, ['Alice', 'Bob', 'Cara'].map((name) => ({ name, newFacts: [fact('새 사실 하나', 'a1'), fact('새 사실 둘', 'a3')], newSpeech: [fact('말끝을 흐린다')] })));
      expect(counts).toEqual({ added: 0, filled: 0, appended: 3 });
      const people = stored(db);
      expect(people.get('Alice')).toMatchObject({ profile: '사람이 쓴 프로필\n  - 들여쓴 줄\n새 사실 하나\n새 사실 둘', speech: '반말\n말끝을 흐린다', evidence: ['a1', 'a3'] });
      expect(people.get('Bob')).toMatchObject({ profile: '가져온 프로필\n새 사실 하나\n새 사실 둘', speech: '말끝을 흐린다', origin: 'import' });
      expect(people.get('Cara')).toMatchObject({ profile: 'AI 프로필\n새 사실 하나\n새 사실 둘', origin: 'ai' });
      expect(db.select().from(s.proposals).all()).toHaveLength(0);
    });

    it('skips a fact the text already says (whitespace and case ignored), also one repeated in the answer', () => {
      const { db, projectId, write } = setup();
      db.insert(s.characters).values({ projectId, name: 'Alice', profile: 'Captain  of the ship\n전직 군인', origin: 'human', statusBy: 'human' }).run();
      const save = (...facts: ReturnType<typeof fact>[]) => aiSaveCharacters(db as never, write, [{ name: 'Alice', newFacts: facts }]);
      expect(save(fact('captain of the SHIP'), fact('전직 군인'), fact('  '))).toEqual({ added: 0, filled: 0, appended: 0 });
      expect(stored(db).get('Alice')!.profile).toBe('Captain  of the ship\n전직 군인');
      expect(save(fact('새 사실'), fact('새  사실'), fact('다른 사실')).appended).toBe(1);
      expect(stored(db).get('Alice')!.profile).toBe('Captain  of the ship\n전직 군인\n새 사실\n다른 사실');
      expect(save(fact('새 사실')).appended).toBe(0);
    });

    it('lets the new facts of a person not stored yet be their profile and speech description', () => {
      const { db, write } = setup();
      aiSaveCharacters(db as never, write, [{ name: 'Guard', newFacts: [fact('성문을 지킨다', 'a1'), fact('겁이 많다', 'a2')], newSpeech: [fact('존댓말을 쓴다')], evidence: ['a3'] }]);
      expect(stored(db).get('Guard')).toMatchObject({ profile: '성문을 지킨다\n겁이 많다', speech: '존댓말을 쓴다', evidence: ['a3', 'a1', 'a2'], origin: 'ai' });
    });

    it('fills an empty profile and writes new facts of a rejected person nowhere', () => {
      const { db, projectId, write } = setup();
      db.insert(s.characters).values([{ projectId, name: 'Alice', profile: '', origin: 'human', statusBy: 'human' }, { projectId, name: 'Bob', profile: '', status: 'rejected', statusBy: 'human' }]).run();
      expect(aiSaveCharacters(db as never, write, [{ name: 'Alice', newFacts: [fact('선장')] }, { name: 'Bob', newFacts: [fact('부하')] }])).toEqual({ added: 0, filled: 0, appended: 1 });
      expect(stored(db).get('Alice')!.profile).toBe('선장');
      expect(stored(db).get('Bob')!.profile).toBe('');
    });

    it('fills role, gender and age band only when unknown, also of a person-written character', () => {
      const { db, projectId, write } = setup();
      db.insert(s.characters).values([
        { projectId, name: 'Alice', role: 'minor', gender: 'unknown', ageBand: 'old', origin: 'import' },
        { projectId, name: 'Bob', role: 'unknown', gender: 'unknown', origin: 'human', statusBy: 'human' },
      ]).run();
      aiSaveCharacters(db as never, write, [{ name: 'Alice', role: 'main', gender: 'female', ageBand: 'child' }, { name: 'Bob', role: 'main', gender: 'male' }]);
      expect(stored(db).get('Alice')).toMatchObject({ role: 'minor', gender: 'female', ageBand: 'old' });
      expect(stored(db).get('Bob')).toMatchObject({ role: 'main', gender: 'male' });
    });
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

  it('adds relationships between stored people and appends new changes to a stored one, whoever made it, leaving its kind and description', () => {
    const { db, projectId, write } = setup();
    aiSaveCharacters(db as never, write, [{ name: 'Alice' }, { name: 'Bob' }]);
    const rel = { from: 'Bob', to: 'Alice', kind: '부하', description: '', changes: [{ at: 'a3', kind: '경계', cause: '지각' }], evidence: ['a2'] };
    expect(aiSaveRelationships(db as never, write, [rel, { from: 'Nobody', to: 'Alice', kind: 'x' }])).toMatchObject({ added: 1, unresolved: ['Nobody → Alice'] });
    const all = () => db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    // An unchecked AI relationship gains a new change.
    aiSaveRelationships(db as never, write, [{ ...rel, changes: [{ at: 'a1', kind: '풀림' }] }]);
    expect(all().map((r) => r.changes.map((change) => change.at))).toEqual([['a3', 'a1']]);
    // A person's relationship gains it too: appended, no candidate row, kind and description kept; a change at a known line is skipped.
    db.update(s.relationships).set({ statusBy: 'human', origin: 'human', description: '사람이 쓴 설명' }).where(eq(s.relationships.projectId, projectId)).run();
    const result = aiSaveRelationships(db as never, write, [{ ...rel, kind: '두목', description: 'AI 설명', changes: [{ at: 'a2', kind: '화해' }, { at: 'a1', kind: '다른 종류' }] }]);
    expect(result).toEqual({ added: 0, changed: 1, unresolved: [] });
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ kind: '부하', description: '사람이 쓴 설명', status: 'confirmed', statusBy: 'human', changes: [{ at: 'a3' }, { at: 'a1', kind: '풀림' }, { at: 'a2', kind: '화해' }] });
    expect(all()[0]!.evidence).toEqual(['a2', 'a1', 'a2'].filter((line, index, list) => list.indexOf(line) === index));
    // Nothing new: nothing changes.
    expect(aiSaveRelationships(db as never, write, [{ ...rel, changes: [{ at: 'a2', kind: '화해' }] }]).changed).toBe(0);
  });

  it('turns the two views of a pair into rows: one mutual row when they agree, one per direction otherwise, none for an unknown direction', () => {
    const { db, projectId, write } = setup();
    aiSaveCharacters(db as never, write, [{ name: 'Alice' }, { name: 'Bob' }]);
    const view = (from: string, to: string, kind: string, extra: Record<string, unknown> = {}) => ({ from, to, kind, description: '', evidence: [], changes: [], ...extra });
    const row = () => db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    const save = (views: ReturnType<typeof view>[]) => aiSaveRelationships(db as never, write, relationshipRows([{ views }]));
    // Different kinds: two directional rows, each with its own kind and changes.
    save([view('Bob', 'Alice', '두목', { changes: [{ at: 'a3', kind: '적', cause: '배신' }] }), view('Alice', 'Bob', '부하', { description: '믿는다' })]);
    expect(row().map((r) => [r.fromId === row()[0]!.fromId ? 'first' : 'second', r.kind, r.mutual, r.changes.map((change) => change.kind)])).toEqual([['first', '두목', false, ['적']], ['second', '부하', false, []]]);
    expect(row()[0]!.changes).toEqual([{ at: 'a3', kind: '적', cause: '배신' }]);
    db.delete(s.relationships).run();
    // The same kind, no changes (the descriptions may differ): one mutual row.
    save([view('Alice', 'Bob', '협력자', { description: '함께 일한다', evidence: ['a1'] }), view('Bob', 'Alice', '협력자', { description: '', evidence: ['a2'] })]);
    expect(row()).toHaveLength(1);
    expect(row()[0]).toMatchObject({ kind: '협력자', mutual: true, description: '함께 일한다', evidence: ['a1', 'a2'] });
    db.delete(s.relationships).run();
    // The same kind but only one direction changes: two rows.
    save([view('Alice', 'Bob', '협력자', { changes: [{ at: 'a3', kind: '적', cause: '' }] }), view('Bob', 'Alice', '협력자')]);
    expect(row().map((r) => r.mutual)).toEqual([false, false]);
    db.delete(s.relationships).run();
    // The same kind and the same change at the same line: mutual.
    save([view('Alice', 'Bob', '협력자', { changes: [{ at: 'a3', kind: '적', cause: '다툼' }] }), view('Bob', 'Alice', '협력자', { changes: [{ at: 'a3', kind: '적', cause: '' }] })]);
    expect(row()).toHaveLength(1);
    expect(row()[0]).toMatchObject({ mutual: true, changes: [{ at: 'a3', kind: '적', cause: '다툼' }] });
    db.delete(s.relationships).run();
    // A pair with one view is one directional row.
    const counts = save([view('Bob', 'Alice', '언니')]);
    expect(counts.added).toBe(1);
    expect(row()).toMatchObject([{ kind: '언니', mutual: false }]);
  });

  it('does not add a rejected rule again and doubts a rule whose evidence is someone else talking', () => {
    const { db, write } = setup();
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
  });

  it('keeps a stored rule: a new stretch or pair is added, a conflicting rule for the same pair and stretch is neither added nor made a candidate', () => {
    const { db, projectId, write } = setup();
    db.insert(s.speechRules).values([
      { projectId, fromName: 'Alice', toName: 'Bob', level: 'hae', startKey: null, status: 'confirmed', statusBy: 'human', origin: 'human' },
      { projectId, fromName: 'Bob', toName: 'Alice', level: 'haeyo', startKey: null, status: 'confirmed', origin: 'import' },
    ]).run();
    const counts = aiSaveSpeechRules(db as never, write, [
      { fromName: 'Alice', toName: 'Bob', level: 'hasipsio' },
      { fromName: 'alice', toName: 'bob', level: 'hae' },
      { fromName: 'Bob', toName: 'Alice', level: 'hae' },
      { fromName: 'Alice', toName: 'Bob', level: 'hasipsio', startKey: 'a3' },
      { fromName: 'Alice', toName: 'Bob', level: 'haeyo', startKey: 'a3' },
      { fromName: 'Alice', toName: 'group', level: 'hae' },
    ]);
    expect(counts).toMatchObject({ added: 2, kept: 4 });
    const rules = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all();
    expect(rules.map((r) => [r.fromName, r.toName, r.startKey ?? '', r.level, r.status].join('|')).sort()).toEqual(['Alice|Bob|a3|hasipsio|confirmed', 'Alice|Bob||hae|confirmed', 'Alice|group||hae|confirmed', 'Bob|Alice||haeyo|confirmed']);
    expect(rules.some((r) => r.status === 'candidate')).toBe(false);
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

  it('sets AI listeners without touching a person\'s or the import\'s', () => {
    const { db, projectId } = setup();
    db.update(s.units).set({ listener: 'Captain', listenerOrigin: 'import' }).where(eq(s.units.key, 'a3')).run();
    db.update(s.units).set({ listener: 'Guard', listenerOrigin: 'human' }).where(eq(s.units.key, 'a2')).run();
    const result = aiSetLineListeners(db as never, projectId, [{ key: 'a1', listener: 'Bob', confidence: 0.9 }, { key: 'a2', listener: 'Alice' }, { key: 'a3', listener: 'Bob' }, { key: 'zz', listener: 'Bob' }]);
    expect(result.set).toBe(1);
    expect(result.skipped.map((entry) => entry.key)).toEqual(['a2', 'a3', 'zz']);
    expect(lines(db, projectId).get('a1')).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.9 });
    expect(lines(db, projectId).get('a3')).toMatchObject({ listener: 'Captain', listenerOrigin: 'import' });
  });
});
