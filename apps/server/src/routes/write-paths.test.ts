import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { batchChangeSchema, importFileSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { applyBatch, validateBatch } from '../services/script-query.ts';
import { attachUnitTags } from '../services/tag-scope.ts';
import { saveTerm } from '../services/terms.ts';
import { knowledgeRoutes } from './knowledge.ts';
import { sourceRoutes } from './source.ts';
import { scriptRoutes } from './script.ts';

/** Two projects, so a write can be seen to stay in its own. Each has a dialogue line `a` and a narration line `n`. */
function setup() {
  const db = openDatabase(':memory:');
  const project = (name: string) => {
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name },
      groups: [{ key: 'g', title: 'G' }],
      units: [
        { key: 'a', group: 'g', kind: 'dialogue', speaker: 'Alice', source: 'Hello' },
        { key: 'n', group: 'g', kind: 'document', source: 'Rain falls.' },
      ],
    });
    const { projectId } = importProject(db, file, null as never);
    const unit = (key: string) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()!;
    const status = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!;
    const tag = (name: string, scope: ('lines' | 'knowledge' | 'terms')[] = ['lines']) => db.insert(s.tags).values({ projectId, name, color: '#112233', scope }).returning().get();
    return { projectId, unit, status, tag };
  };
  const mine = project('Mine');
  const other = project('Other');
  const app = new Hono<Env>()
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes)
    .route('/', scriptRoutes)
    .route('/projects/:projectId', knowledgeRoutes);
  const send = (method: string, url: string, body: unknown, extraHeaders: Record<string, string> = {}) => app.request(url, { method, headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
  const tagsOf = (unitId: string) => db.select().from(s.unitTags).where(eq(s.unitTags.unitId, unitId)).all().map((row) => row.tagId);
  return { db, mine, other, send, tagsOf };
}

describe('writes stay inside the project', () => {
  it('keeps terminal tool proposals detached from any chat', async () => {
    const { db, mine, send } = setup();
    const response = await send('POST', `/projects/${mine.projectId}/tools/save_character`, { name: 'Carol' });
    expect(response.status).toBe(200);
    const result = await response.json() as { proposalId: string };
    expect(db.select().from(s.proposals).where(eq(s.proposals.id, result.proposalId)).get()).toMatchObject({ sessionId: null, status: 'pending' });
  });

  it('a bulk patch refuses another project\'s status, tags and lines, and changes nothing', async () => {
    const { db, mine, other, send, tagsOf } = setup();
    const foreignTag = other.tag('x');
    const before = db.select().from(s.units).where(eq(s.units.id, other.unit('a').id)).get()!;
    for (const body of [
      { unitIds: [mine.unit('a').id], statusId: other.status.id },
      { unitIds: [mine.unit('a').id], addTagIds: [foreignTag.id] },
      { unitIds: [mine.unit('a').id], removeTagIds: [foreignTag.id] },
      { unitIds: [mine.unit('a').id, other.unit('a').id], statusId: mine.status.id },
    ]) {
      const response = await send('PATCH', `/projects/${mine.projectId}/units`, body);
      expect(response.status).toBe(400);
    }
    expect(tagsOf(mine.unit('a').id)).toEqual([]);
    expect(db.select().from(s.units).where(eq(s.units.id, other.unit('a').id)).get()).toEqual(before);
    expect(mine.unit('a').statusBy).toBe('human');
  });

  it('a single patch refuses another project\'s status, tag and candidate; repeated tag ids are fine', async () => {
    const { db, mine, other, send, tagsOf } = setup();
    const foreignTag = other.tag('x');
    const ownTag = mine.tag('own');
    const foreignCandidate = db.insert(s.candidates).values({ unitId: other.unit('a').id, text: 'x', origin: 'human' }).returning().get();
    const unitId = mine.unit('a').id;
    expect((await send('POST', `/units/${unitId}/save`, { statusId: other.status.id })).status).toBe(400);
    expect((await send('PATCH', `/units/${unitId}`, { tagIds: [foreignTag.id] })).status).toBe(400);
    expect((await send('POST', `/units/${unitId}/save`, { candidateId: foreignCandidate.id })).status).toBe(400);
    expect((await send('PATCH', `/units/${unitId}`, { tagIds: [ownTag.id, ownTag.id] })).status).toBe(200);
    expect(tagsOf(unitId)).toEqual([ownTag.id]);
    // The list is replaced, not added to.
    expect((await send('PATCH', `/units/${unitId}`, { tagIds: [] })).status).toBe(200);
    expect(tagsOf(unitId)).toEqual([]);
  });
});

describe('a listener is for dialogue only', () => {
  it('one line: refused for narration; a selection: narration is left alone; an accepted batch: skipped and reported', async () => {
    const { db, mine, send } = setup();
    const dialogue = mine.unit('a').id;
    const narration = mine.unit('n').id;
    expect((await send('PATCH', `/units/${narration}`, { listener: 'Bob' })).status).toBe(400);
    // "Unknown" is fine anywhere.
    expect((await send('PATCH', `/units/${narration}`, { listener: null })).status).toBe(200);

    expect((await send('PATCH', `/projects/${mine.projectId}/units`, { unitIds: [dialogue, narration], listener: 'Bob' })).status).toBe(200);
    const listener = (id: string) => db.select({ listener: s.units.listener, origin: s.units.listenerOrigin }).from(s.units).where(eq(s.units.id, id)).get()!;
    expect(listener(dialogue)).toEqual({ listener: 'Bob', origin: 'human' });
    expect(listener(narration)).toEqual({ listener: null, origin: null });

    const batch = batchChangeSchema.parse({ origin: 'human', changes: [{ key: 'n', listener: 'Bob' }, { key: 'a', listener: 'Cy' }] });
    expect(validateBatch(db, mine.projectId, batch).errors.map((error) => error.key)).toEqual(['n']);
    const result = applyBatch(db, mine.projectId, batch);
    expect(result.applied).toBe(1);
    expect(result.skipped.map((row) => row.key)).toEqual(['n']);
    expect(listener(dialogue).listener).toBe('Cy');
    expect(listener(narration)).toEqual({ listener: null, origin: null });
  });
});

describe('one term per source', () => {
  it('refuses a second term with the same source in any case, on create and on rename', async () => {
    const { db, mine, other, send } = setup();
    const base = `/projects/${mine.projectId}/terms`;
    expect((await send('POST', base, { source: 'Ghost', target: '유령' })).status).toBe(201);
    const again = await send('POST', base, { source: ' ghost ', target: '귀신' });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('이미 있는 용어입니다');
    const second = (await (await send('POST', base, { source: 'Vera', target: '베라' })).json()) as { id: string };
    expect((await send('PATCH', `${base}/${second.id}`, { source: 'GHOST' })).status).toBe(400);
    expect((await send('PATCH', `${base}/${second.id}`, { target: '새 베라' })).status).toBe(200);
    // Another project may have the same source.
    expect((await send('POST', `/projects/${other.projectId}/terms`, { source: 'Ghost' })).status).toBe(201);
    const count = db.select().from(s.terms).where(eq(s.terms.projectId, mine.projectId)).all().length;
    expect(count).toBe(2);
    // The database holds the same rule.
    expect(() => db.insert(s.terms).values({ projectId: mine.projectId, source: 'GHOST' }).run()).toThrow();
  });

  it('a rejected term does not block: it is revived by a create and dropped by a rename onto it; a term saved by the chat reports a duplicate', () => {
    const { db, mine } = setup();
    const { projectId } = mine;
    const rejected = db.insert(s.terms).values({ projectId, source: 'Old', status: 'rejected', origin: 'ai', statusBy: 'human' }).returning().get();
    const revived = saveTerm(db, projectId, { source: 'old', target: '옛' }, { by: 'person' });
    expect(revived.ok && revived.row.id).toBe(rejected.id);
    expect(revived.ok && revived.row.status).not.toBe('rejected');

    const gone = db.insert(s.terms).values({ projectId, source: 'Gone', status: 'rejected' }).returning().get();
    const keep = db.insert(s.terms).values({ projectId, source: 'Keep' }).returning().get();
    expect(saveTerm(db, projectId, { source: 'gone' }, { id: keep.id, by: 'person' }).ok).toBe(true);
    expect(db.select().from(s.terms).where(eq(s.terms.id, gone.id)).get()).toBeUndefined();

    const dup = saveTerm(db, projectId, { source: 'GONE' }, { by: 'person' });
    expect(dup.ok).toBe(false);
  });
});

describe('attachUnitTags', () => {
  it('refuses or skips tags that are not the project\'s or not for lines, and only removes from the project\'s lines', () => {
    const { db, mine, other, tagsOf } = setup();
    const lineTag = mine.tag('line');
    const termsOnly = mine.tag('terms-only', ['terms']);
    const foreign = other.tag('foreign');
    const unitId = mine.unit('a').id;

    expect(() => attachUnitTags(db, mine.projectId, [unitId], { add: [lineTag.id, termsOnly.id] }, { onMisplaced: 'refuse' })).toThrow();
    expect(() => attachUnitTags(db, mine.projectId, [unitId], { add: [foreign.id] }, { onMisplaced: 'refuse' })).toThrow();
    expect(tagsOf(unitId)).toEqual([]);

    const { skipped } = attachUnitTags(db, mine.projectId, [unitId, unitId], { add: [lineTag.id, termsOnly.id, foreign.id] }, { onMisplaced: 'skip' });
    expect(skipped.map((tag) => tag.id).sort()).toEqual([termsOnly.id, foreign.id].sort());
    expect(tagsOf(unitId)).toEqual([lineTag.id]);

    // The other project's line keeps its tag even when asked for by id.
    db.insert(s.unitTags).values({ unitId: other.unit('a').id, tagId: foreign.id }).run();
    attachUnitTags(db, mine.projectId, [other.unit('a').id, unitId], { remove: [foreign.id, lineTag.id] }, { onMisplaced: 'skip' });
    expect(tagsOf(other.unit('a').id)).toEqual([foreign.id]);
    expect(tagsOf(unitId)).toEqual([]);
  });
});

describe('a person\'s first text', () => {
  it('moves a 미번역 line to 번역됨; a later save or an explicit status keeps what it says', async () => {
    const { db, mine, send } = setup();
    const statusOf = (id: string) => db.select({ name: s.statuses.name }).from(s.statuses).innerJoin(s.units, eq(s.units.statusId, s.statuses.id)).where(eq(s.units.id, id)).get()?.name;
    const line = mine.unit('a');
    expect(statusOf(line.id)).toBe('미번역');
    // Whitespace is not a translation: the line stays untranslated.
    await send('POST', `/units/${line.id}/save`, { text: '  ' });
    expect(statusOf(line.id)).toBe('미번역');
    await send('POST', `/units/${line.id}/save`, { text: '안녕' });
    expect(statusOf(line.id)).toBe('번역됨');
    const confirmed = db.select().from(s.statuses).where(and(eq(s.statuses.projectId, mine.projectId), eq(s.statuses.kind, 'final'))).get()!;
    await send('POST', `/units/${line.id}/save`, { text: '안녕하세요', statusId: confirmed.id });
    expect(statusOf(line.id)).toBe('완료');
    await send('POST', `/units/${line.id}/save`, { text: '안녕!' });
    expect(statusOf(line.id)).toBe('완료');
  });
});

describe('one save for a line (text, candidate and status together)', () => {
  const read = (db: ReturnType<typeof setup>['db'], unitId: string) => ({
    line: db.select({ translation: s.units.translation, candidateId: s.units.candidateId }).from(s.units).where(eq(s.units.id, unitId)).get()!,
    candidates: db.select({ id: s.candidates.id, text: s.candidates.text }).from(s.candidates).where(eq(s.candidates.unitId, unitId)).all(),
    status: db.select({ name: s.statuses.name }).from(s.statuses).innerJoin(s.units, eq(s.units.statusId, s.statuses.id)).where(eq(s.units.id, unitId)).get()?.name,
  });

  it('the typed text is the line, its selected candidate and its status in one write', async () => {
    const { db, mine, send } = setup();
    const unitId = mine.unit('a').id;
    const response = await send('POST', `/units/${unitId}/save`, { text: '적어 둬.', base: '' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ translation: '적어 둬.' });
    const after = read(db, unitId);
    expect(after.line.translation).toBe('적어 둬.');
    expect(after.candidates).toEqual([{ id: after.line.candidateId, text: '적어 둬.' }]);
    expect(after.status).toBe('번역됨');
  });

  it('a rapid double save of the same text is one candidate; a late save from the old text cannot empty the line', async () => {
    const { db, mine, send } = setup();
    const unitId = mine.unit('a').id;
    // Two clicks before the first answer: both start from the empty line.
    const [first, second] = await Promise.all([send('POST', `/units/${unitId}/save`, { text: '적어 둬.', base: '' }), send('POST', `/units/${unitId}/save`, { text: '적어 둬.', base: '' })]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(read(db, unitId).candidates.map((candidate) => candidate.text)).toEqual(['적어 둬.']);
    // An echo of the old (empty) text from a stale editor is refused, not saved over what was typed.
    expect((await send('POST', `/units/${unitId}/save`, { text: '', base: '' })).status).toBe(409);
    // Saving the current text again changes nothing.
    expect((await send('POST', `/units/${unitId}/save`, { text: '적어 둬.', base: '' })).status).toBe(200);
    const after = read(db, unitId);
    expect(after.line.translation).toBe('적어 둬.');
    expect(after.candidates).toHaveLength(1);
    expect(after.status).toBe('번역됨');
  });

  it('picking a candidate or retyping a candidate\'s text selects it; text never goes through the line patch', async () => {
    const { db, mine, send } = setup();
    const unitId = mine.unit('a').id;
    await send('POST', `/units/${unitId}/save`, { text: '하나' });
    await send('POST', `/units/${unitId}/save`, { text: '둘' });
    const one = read(db, unitId).candidates.find((candidate) => candidate.text === '하나')!;
    await send('POST', `/units/${unitId}/save`, { candidateId: one.id });
    expect(read(db, unitId).line).toEqual({ translation: '하나', candidateId: one.id });
    await send('POST', `/units/${unitId}/save`, { text: '둘' });
    expect(read(db, unitId).candidates).toHaveLength(2);
    expect((await send('PATCH', `/units/${unitId}`, { translation: '셋' })).status).toBe(400);
    expect(read(db, unitId).line.translation).toBe('둘');
  });
});
