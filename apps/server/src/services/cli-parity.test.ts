import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, lineFilterSchema } from '@tw/shared';
import type { Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import { sourceRoutes } from '../routes/source.ts';
import * as s from '../db/schema.ts';
import { agentCatalog } from './agent-catalog.ts';
import { importProject } from './importer.ts';
import { prepareProposal } from './proposal-check.ts';
import { resolveRunScope } from './run-plan.ts';
import { findLines } from './script-query.ts';
import { tagOverview } from './tag-overview.ts';
import { findTerm, termUsage } from './term-usage.ts';
import { listTerms } from './terms.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  return { db, projectId };
}

describe('CLI parity with the app', () => {
  it('finds the same lines as the app\'s list for text with %, _, \\ and quotes, and for several tags (all of them)', async () => {
    const db = openDatabase(':memory:');
    const sources = ['50% done', 'Hello world', 'a_b', 'axb', 'C:\\dir', 'Cdir', 'say "hi"', '100%% sure'];
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'P' },
      groups: [{ key: 'g', title: 'G' }],
      units: sources.map((source, n) => ({ key: `u${n}`, group: 'g', source, tags: n === 0 ? ['A', 'B'] : n === 1 ? ['A'] : n === 2 ? ['B'] : [] })),
    });
    const { projectId } = importProject(db, file);
    const app = new Hono<Env>()
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);
    const appKeys = async (params: Record<string, string>) => {
      const body = (await (await app.request(`/projects/${projectId}/units?${new URLSearchParams(params)}`)).json()) as { rows: { key: string }[] };
      return body.rows.map((row) => row.key);
    };
    const cliKeys = (filter: object) => findLines(db, projectId, lineFilterSchema.parse(filter)).rows.map((row) => row.key);
    const cases: [string, string[]][] = [
      ['%', ['u0', 'u7']],
      ['_', ['u2']],
      ['\\', ['u4']],
      [':\\d', ['u4']],
      ['"hi"', ['u6']],
      ['%%', ['u7']],
    ];
    for (const [q, keys] of cases) {
      expect(cliKeys({ q }), q).toEqual(keys);
      expect(await appKeys({ q }), q).toEqual(keys);
    }
    const tagIds = db.select().from(s.tags).where(eq(s.tags.projectId, projectId)).all();
    const id = (name: string) => tagIds.find((tag) => tag.name === name)!.id;
    expect(cliKeys({ tags: ['A', 'B'] })).toEqual(['u0']);
    expect(await appKeys({ tagIds: `${id('A')},${id('B')}` })).toEqual(['u0']);
    expect(cliKeys({ tags: ['A'] })).toEqual(['u0', 'u1']);
  });

  it('lists terms with usage, marks and the status / unreviewed filters', () => {
    const { db, projectId } = setup();
    db.insert(s.terms).values([
      { projectId, source: 'Zed Unused', target: '', status: 'candidate', statusBy: 'ai' },
      { projectId, source: 'Quiet', target: '조용', status: 'confirmed', statusBy: 'ai' },
      { projectId, source: 'Plain', target: '평범', status: 'confirmed', statusBy: 'human' },
    ]).run();
    const all = listTerms(db, projectId, {});
    const zed = all.terms.find((term) => term.source === 'Zed Unused')!;
    expect(zed.marks).toEqual(['unused']);
    expect(zed.lines).toBe(0);
    // unreviewed = status candidate or decided by AI; a human-confirmed term is neither.
    const unreviewed = listTerms(db, projectId, { unreviewed: true }).terms.map((term) => term.source);
    expect(unreviewed).toEqual(expect.arrayContaining(['Zed Unused', 'Quiet']));
    expect(unreviewed).not.toContain('Plain');
    // status is the 상태 column: candidate or confirmed, several mean either
    const candidates = listTerms(db, projectId, { status: ['candidate'] }).terms.map((term) => term.source);
    expect(candidates).toContain('Zed Unused');
    expect(candidates).not.toContain('Plain');
    const confirmed = listTerms(db, projectId, { status: ['confirmed'] }).terms.map((term) => term.source);
    expect(confirmed).toEqual(expect.arrayContaining(['Plain', 'Quiet']));
    expect(confirmed).not.toContain('Zed Unused');
    expect(listTerms(db, projectId, { status: ['candidate', 'confirmed'] }).total).toBe(all.total);
    // filters must all hold, and combine with status
    expect(listTerms(db, projectId, { status: ['candidate'], emptyTarget: true }).terms.map((term) => term.source)).toContain('Zed Unused');
    expect(listTerms(db, projectId, { status: ['confirmed'], emptyTarget: true }).total).toBe(0);
    expect(listTerms(db, projectId, { decidedBy: 'ai', emptyTarget: true }).terms.map((term) => term.source)).not.toContain('Quiet');
    expect(listTerms(db, projectId, { limit: 1 }).terms).toHaveLength(1);
  });

  it('finds a term by id or source and lists its lines like the usage endpoint', () => {
    const { db, projectId } = setup();
    const term = db.insert(s.terms).values({ projectId, source: 'relay', target: '중계' }).returning().get();
    expect(findTerm(db, projectId, 'RELAY')?.id).toBe(term.id);
    expect(findTerm(db, projectId, term.id)?.source).toBe('relay');
    const rows = termUsage(db, projectId, term);
    expect(rows.every((row) => /\brelay\b/i.test(row.source))).toBe(true);
  });

  it('gives each line what its row shows (who set the status, memo, 번역 제외) and filters by it', () => {
    const { db, projectId } = setup();
    const row = findLines(db, projectId, lineFilterSchema.parse({ limit: 5 })).rows[0]!;
    expect(row).toMatchObject({ statusBy: 'human', note: '', excluded: false, marks: [] });
    db.update(s.units).set({ note: 'check', statusBy: 'ai' }).where(eq(s.units.id, row.id)).run();
    expect(findLines(db, projectId, lineFilterSchema.parse({ keys: [row.key] })).rows[0]).toMatchObject({ statusBy: 'ai', note: 'check' });
    expect(findLines(db, projectId, lineFilterSchema.parse({ noted: true, decidedBy: 'ai' })).rows.map((line) => line.key)).toEqual([row.key]);
    expect(findLines(db, projectId, lineFilterSchema.parse({ keys: [row.key], unfinished: false })).rows).toEqual([]);
  });

  it('marks lines that share a source but differ in translation', () => {
    const { db, projectId } = setup();
    const [a, b] = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    db.update(s.units).set({ source: 'Same text.', translation: '하나' }).where(eq(s.units.id, a!.id)).run();
    db.update(s.units).set({ source: 'same text', translation: '둘' }).where(eq(s.units.id, b!.id)).run();
    const rows = findLines(db, projectId, lineFilterSchema.parse({ keys: [a!.key, b!.key] }), { diverged: true }).rows;
    expect(rows.every((row) => row.marks.includes('diverged'))).toBe(true);
    expect(findLines(db, projectId, lineFilterSchema.parse({ keys: [a!.key] })).rows[0]!.marks).not.toContain('diverged');
  });

  it('lists tags and built-in marks with where they go', () => {
    const { db, projectId } = setup();
    const { tags, marks } = tagOverview(db, projectId);
    expect(tags.every((tag) => tag.places.length > 0)).toBe(true);
    expect(marks.find((mark) => mark.id === 'unused')?.scope).toEqual(['terms']);
    expect(marks.map((mark) => mark.id)).not.toContain('remaining');
    expect(marks.find((mark) => mark.id === 'review')?.scope).toEqual(['people', 'documents', 'events']);
  });

  it('refuses a duplicate term when the proposal is made, and keeps the rest', async () => {
    const { db, projectId } = setup();
    db.insert(s.terms).values({ projectId, source: 'Guild', target: '길드' }).run();
    const prepared = await prepareProposal(db, projectId, 'save_terms', { terms: [{ source: 'guild', target: 'x' }, { source: 'Harbor', target: '항구' }, { source: 'HARBOR', target: 'y' }] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect((prepared.input.terms as { source: string }[]).map((term) => term.source)).toEqual(['Harbor']);
    expect(prepared.report?.dropped.map((entry) => entry.key)).toEqual(['guild', 'HARBOR']);
    expect(prepared.report?.dropped[0]!.reason).toContain('이미 있는 용어');
    expect(await prepareProposal(db, projectId, 'save_terms', { terms: [{ source: 'Guild', target: 'x' }] })).toEqual({ ok: false, error: expect.stringContaining('저장할 수 있는 용어가 없습니다') });
  });

  it('resolves a run scope from names, keys and tags and reports what it did not find', () => {
    const { db, projectId } = setup();
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const group = db.select().from(s.groups).where(eq(s.groups.id, unit.groupId)).get()!;
    const { scope, unknown } = resolveRunScope(db, projectId, { groups: [group.title, 'nope'], keys: [unit.key], tags: ['no-tag'], marks: ['aiSuggestion'], unfinished: true });
    expect(scope).toMatchObject({ marks: ['aiSuggestion'], unfinished: true });
    expect(scope.groupIds).toEqual([group.id]);
    expect(scope.unitIds).toEqual([unit.id]);
    expect(unknown).toEqual(['묶음 nope', '태그 no-tag']);
  });

  it('exposes the new read tools and filters knowledge lists', async () => {
    const { db, projectId } = setup();
    const catalog = agentCatalog(db, projectId);
    for (const name of ['list_terms', 'term_usage', 'list_tags', 'plan_run', 'list_characters', 'list_events', 'list_speech_rules', 'read_documents']) expect(catalog.some((tool) => tool.name === name && !tool.changes)).toBe(true);
    const events = catalog.find((tool) => tool.name === 'list_events')!;
    const all = (await events.run({})) as { marks: string[] }[];
    const unreviewed = (await events.run({ unreviewed: true })) as { status: string; marks: string[] }[];
    expect(all.every((event) => Array.isArray(event.marks))).toBe(true);
    expect(unreviewed.every((event) => event.status === 'candidate' || event.marks.includes('ai'))).toBe(true);
  });
});
