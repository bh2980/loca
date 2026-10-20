import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, termMarksOf } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from './importer.ts';
import { memoryStore } from './secrets.ts';
import { fillTermUsage } from './term-usage.ts';
import { addNameTerms, discoverAndSave, NOT_A_TERM, TermService } from './terms.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Plaza' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Symes', source: 'They met at Freedom Plaza.', translation: '그들은 자유 광장에서 만났다.' },
      { key: 'a2', group: 'g1', speaker: 'Symes', source: 'Was Freedom Plaza busy? Thank God it was not.' },
      { key: 'a3', group: 'g1', speaker: 'Nina', source: 'Thank God for Thought.' },
      { key: 'a4', group: 'g1', speaker: 'Nina', source: 'I left Thought.' },
    ],
    characters: [{ name: 'Nina' }],
  });
  const { projectId } = importProject(db, file);
  return { db, projectId, choice };
}

const terms = (db: ReturnType<typeof setup>['db'], projectId: string) =>
  db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all().sort((a, b) => a.source.localeCompare(b.source));

/** Candidates as analysis or a person would add them (origin script, no count yet). */
const seed = (db: ReturnType<typeof setup>['db'], projectId: string) =>
  db.insert(s.terms).values(['Freedom Plaza', 'God', 'Nina', 'Thought'].map((source) => ({ projectId, source, status: 'candidate' as const, origin: 'script' as const, note: source === 'Nina' ? '인물 이름' : '' }))).run();

describe('glossary', () => {
  it('counts the lines using each term once, whole word, and again when its source changes', () => {
    const { db, projectId } = setup();
    seed(db, projectId);
    fillTermUsage(db, projectId);
    expect(terms(db, projectId).map(({ source, lines, examples }) => ({ source, lines, examples }))).toEqual([
      { source: 'Freedom Plaza', lines: 2, examples: ['a1', 'a2'] },
      { source: 'God', lines: 2, examples: ['a2', 'a3'] },
      { source: 'Nina', lines: 2, examples: ['a3', 'a4'] },
      { source: 'Thought', lines: 2, examples: ['a3', 'a4'] },
    ]);
    db.update(s.terms).set({ source: 'Plaza', lines: null }).where(eq(s.terms.source, 'Freedom Plaza')).run();
    fillTermUsage(db, projectId);
    expect(terms(db, projectId).find((term) => term.source === 'Plaza')).toMatchObject({ lines: 2, examples: ['a1', 'a2'] });
  });

  it('counts a name said only in the speaker column and never marks it unused', () => {
    const { db, projectId } = setup();
    db.insert(s.terms).values({ projectId, source: 'Symes', status: 'confirmed', origin: 'script' }).run();
    fillTermUsage(db, projectId);
    const symes = terms(db, projectId).find((term) => term.source === 'Symes')!;
    expect(symes).toMatchObject({ lines: 2, examples: ['a1', 'a2'] });
    expect(termMarksOf(symes)).not.toContain('unused');
  });

  it('counts a line once when the term is both its source and its speaker', () => {
    const { db, projectId } = setup();
    const statusId = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.id;
    const groupId = db.select().from(s.groups).get()!.id;
    db.insert(s.units).values({ projectId, groupId, statusId, sort: 5, seq: 5, kind: 'dialogue', key: 'a5', speaker: 'Nina', source: 'Nina left.' }).run();
    db.insert(s.terms).values({ projectId, source: 'Nina', status: 'candidate', origin: 'script' }).run();
    fillTermUsage(db, projectId);
    expect(terms(db, projectId).find((term) => term.source === 'Nina')).toMatchObject({ lines: 3, examples: ['a3', 'a4', 'a5'] });
  });

  it('adds a character\'s new alias as a candidate marked as theirs', () => {
    const { db, projectId } = setup();
    seed(db, projectId);
    // A note someone wrote stays.
    db.update(s.terms).set({ note: '사람 메모' }).where(eq(s.terms.source, 'Thought')).run();
    expect(addNameTerms(db, projectId, { name: 'Nina', aliases: ['Thought', 'Nin'] })).toBe(1);
    expect(terms(db, projectId).filter((term) => ['Thought', 'Nin'].includes(term.source)).map(({ source, note, status }) => ({ source, note, status }))).toEqual([
      { source: 'Nin', note: 'Nina의 별칭', status: 'candidate' },
      { source: 'Thought', note: '사람 메모', status: 'candidate' },
    ]);
  });

  it('fills empty candidates from the model with example lines, marks ordinary words and leaves a person’s edits alone', async () => {
    const { db, projectId, choice } = setup();
    seed(db, projectId);
    db.update(s.terms).set({ target: '니나' }).where(eq(s.terms.source, 'Nina')).run();
    const prompts: string[] = [];
    const service = new TermService(db, memoryStore(), {
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        return {
          object: {
            terms: [
              { source: 'Freedom Plaza', isTerm: true, target: '자유 광장', note: '지명' },
              { source: 'God', isTerm: false, target: '신', note: '감탄' },
              { source: 'Thought', isTerm: true, target: '사상', note: '단체 이름' },
            ],
          },
          usage: { inputTokens: 100, outputTokens: 20 },
        } as never;
      },
    });
    expect(service.pending(projectId).map((term) => term.source)).toEqual(['Freedom Plaza', 'God', 'Thought']);
    service.start(projectId, choice);
    for (let i = 0; i < 50 && service.state(projectId)?.running; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(service.state(projectId)).toMatchObject({ running: false, done: 3, total: 3, usage: { inputTokens: 100, outputTokens: 20 } });
    // The job is kept for 실행 기록, and its request is in the AI log under it.
    const job = db.select().from(s.termJobs).get()!;
    expect(job).toMatchObject({ projectId, status: 'completed', done: 3, total: 3, usage: { inputTokens: 100, outputTokens: 20 } });
    expect(db.select().from(s.aiCalls).all()).toMatchObject([{ kind: 'terms', refId: job.id, status: 'ok', inputTokens: 100 }]);
    const input = JSON.parse(prompts[0]);
    expect(input.candidates[0]).toEqual({ source: 'Freedom Plaza', lines: 2, examples: [{ speaker: 'Symes', source: 'They met at Freedom Plaza.', translation: '그들은 자유 광장에서 만났다.' }, { speaker: 'Symes', source: 'Was Freedom Plaza busy? Thank God it was not.' }] });
    expect(terms(db, projectId).map(({ source, target, note, origin, status }) => ({ source, target, note, origin, status }))).toEqual([
      { source: 'Freedom Plaza', target: '자유 광장', note: '지명', origin: 'ai', status: 'candidate' },
      { source: 'God', target: '', note: NOT_A_TERM, origin: 'ai', status: 'candidate' },
      { source: 'Nina', target: '니나', note: '인물 이름', origin: 'script', status: 'candidate' },
      { source: 'Thought', target: '사상', note: '단체 이름', origin: 'ai', status: 'candidate' },
    ]);
    // Ordinary words are not sent again.
    expect(service.pending(projectId)).toEqual([]);
  });

  it('discovers terms across the script and saves them as candidates', () => {
    const { db, projectId } = setup();
    const statusId = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).get()!.id;
    const groupId = db.select().from(s.groups).get()!.id;
    // Add units with bracketed terms and katakana/names
    db.insert(s.units).values([
      { projectId, groupId, statusId, sort: 10, seq: 10, kind: 'dialogue', key: 'b1', source: 'The 『Orb of Power』 is glowing.' },
      { projectId, groupId, statusId, sort: 11, seq: 11, kind: 'dialogue', key: 'b2', source: 'Protect the 『Orb of Power』.' },
    ]).run();
    const result = discoverAndSave(db, projectId);
    expect(result.found).toBeGreaterThan(0);
    expect(result.added).toBeGreaterThan(0);
    const orb = terms(db, projectId).find((t) => t.source === 'Orb of Power');
    expect(orb).toBeDefined();
    expect(orb?.status).toBe('candidate');
    expect(orb?.origin).toBe('script');
    expect(orb?.lines).toBe(2);
  });
});
