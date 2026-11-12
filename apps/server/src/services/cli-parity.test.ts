import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { importFileSchema, lineFilterSchema, linesById, resolvedLineFilterSchema, runScopeSchema, type UnpagedLineFilter } from '@loca/shared';
import { onError, type Env } from '../http.ts';
import { openDatabase } from '../db/index.ts';
import { sourceRoutes } from '../routes/source.ts';
import * as s from '../db/schema.ts';
import { agentCatalog, prepareProposal } from './agent-catalog.ts';
import { importProject } from './importer.ts';
import { excludedInScope, selectRunUnits } from '../engine/subjects.ts';
import { resolveLineFilter } from '../domain/line-filter.ts';
import { askedScope, resolveRunScope } from './run-plan.ts';
import { findLines } from './script-query.ts';
import { tagOverview } from './tag-overview.ts';
import { findTerm, termUsage } from '../domain/term-usage.ts';
import { listTerms } from '../domain/terms.ts';

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse(JSON.parse(readFileSync(new URL('../../../../samples/relay-station.json', import.meta.url), 'utf8')));
  const { projectId } = importProject(db, file);
  return { db, projectId };
}

/**
 * A small project where every field of the line filter picks some lines and leaves others: two scenes in two chapters,
 * a UI group and a document; Mira under two spellings (her name and the game's speaker key); listeners known and
 * unknown; tags, statuses (one final, one shown in the review inbox), a memo, a status set by AI, a 번역 제외 line,
 * an AI 제안 waiting, two lines that share a source but not a translation, and a saved graph view of two lines.
 */
function filterFixture() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Filters' },
    groups: [
      { key: 'g1', title: 'Pier', section: 'Ch1' },
      { key: 'g2', title: 'Market', section: 'Ch2' },
      { key: 'ui', title: 'Menu', kind: 'ui', section: 'UI' },
      { key: 'doc', title: 'Letter', kind: 'document', section: 'UI' },
    ],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Mira', listener: 'Jonas', source: 'Hello Jonas, 50% done', tags: ['A', 'B'] },
      { key: 'a2', group: 'g1', speaker: 'MIRA_KEY', source: 'The tide is high.', tags: ['A'] },
      { key: 'a3', group: 'g1', speaker: 'Jonas', listener: 'Mira', source: 'Mira said wait.' },
      { key: 'a4', group: 'g1', source: 'Night falls.' },
      { key: 'b1', group: 'g2', speaker: 'Jonas', source: 'Same text.', translation: '하나', tags: ['B'] },
      { key: 'b2', group: 'g2', speaker: 'Mira', source: 'same text', translation: '둘' },
      { key: 'b3', group: 'g2', speaker: 'Stranger', source: 'Who is {MIRA_KEY}?' },
      { key: 'c1', group: 'ui', kind: 'ui', source: 'Start', translation: '시작' },
      { key: 'c2', group: 'ui', kind: 'ui', source: 'Quit' },
      { key: 'd1', group: 'doc', kind: 'document', source: 'Dear Mira,' },
    ],
    graph: { nodes: [{ key: 'n1', units: ['a1', 'a2'] }, { key: 'n2', units: ['a3'] }], edges: [{ from: 'n1', to: 'n2' }] },
    characters: [{ name: 'Mira', aliases: ['MIRA_KEY'] }, { name: 'Jonas' }],
  });
  const { projectId } = importProject(db, file);
  const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all();
  const id = (key: string) => units.find((unit) => unit.key === key)!.id;
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const initial = statuses.find((status) => status.kind === 'initial')!;
  const final = statuses.find((status) => status.kind === 'final')!;
  const review = statuses.find((status) => status.kind === 'normal')!;
  // Exactly one status is shown in the review inbox, and every line starts in the initial one.
  db.update(s.statuses).set({ inReview: false }).where(eq(s.statuses.projectId, projectId)).run();
  db.update(s.statuses).set({ inReview: true }).where(eq(s.statuses.id, review.id)).run();
  db.update(s.units).set({ statusId: initial.id, statusBy: 'human' }).where(eq(s.units.projectId, projectId)).run();
  for (const key of ['b1', 'c1']) db.update(s.units).set({ statusId: final.id }).where(eq(s.units.id, id(key))).run();
  db.update(s.units).set({ statusId: review.id, statusBy: 'ai' }).where(eq(s.units.id, id('a3'))).run();
  db.update(s.units).set({ note: 'check' }).where(eq(s.units.id, id('a2'))).run();
  db.update(s.units).set({ translate: 'exclude' }).where(eq(s.units.id, id('c2'))).run();
  db.insert(s.candidates).values({ unitId: id('a4'), text: '밤이 온다.', origin: 'ai', state: 'pending' }).run();
  const node = db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, 'n1'))).get()!;
  db.insert(s.graphViews).values({ id: 'view-opening', projectId, label: 'Opening', nodeIds: [node.id] }).run();
  db.insert(s.graphViews).values({ id: 'view-empty', projectId, label: 'Nothing', nodeIds: [] }).run();
  const app = new Hono<Env>().onError(onError)
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes);
  const post = (path: string, body: unknown) => app.request(`/projects/${projectId}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const keyOf = new Map(units.map((unit) => [unit.id, unit.key]));
  const inOrder = (ids: string[]) => units.filter((unit) => ids.includes(unit.id)).map((unit) => unit.key);
  /** The same filter on every surface: the app's list (and its matches), the CLI and chat (findLines), and a run's scope. */
  const surfaces = async (filter: UnpagedLineFilter) => {
    const listed = await post('units/ids', { filter: { ...filter, limit: 500 } });
    const matched = await post('units/matches', { filter });
    // A refusal's message is the response's text here (the app's error handler turns it into { error }).
    if (listed.status !== 200) return { error: ((await listed.json()) as { error: string }).error, matchesStatus: matched.status };
    const list = (await listed.json()) as { total: number; ids: string[] };
    const matches = ((await matched.json()) as { rows: { id: string }[] }).rows.map((row) => keyOf.get(row.id)!);
    const found = findLines(db, projectId, lineFilterSchema.parse({ ...filter, limit: 1000 }));
    const scope = askedScope(db, projectId, 'lines', { filter });
    if (!scope.ok) throw new Error(scope.error);
    return { list: list.ids.map((unitId) => keyOf.get(unitId)!), total: list.total, matches, found: found.rows.map((row) => row.key), run: inOrder(selectRunUnits(db, projectId, scope.scope)), excluded: excludedInScope(db, projectId, scope.scope), resolved: scope.scope.filter ?? {} };
  };
  return { db, projectId, id, initial, final, review, surfaces, keys: units.map((unit) => unit.key) };
}

type Fixture = ReturnType<typeof filterFixture>;
type FilterCase = (fixture: Fixture) => { filter: UnpagedLineFilter; keys: string[] };
const ALL = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'c1', 'c2', 'd1'];
const except = (...keys: string[]) => ALL.filter((key) => !keys.includes(key));
/** 번역 제외 (a person's call on the line): listed like any line, never in a run. */
const EXCLUDED = ['c2'];

/**
 * One row per field of lineFilterSchema: a filter that uses the field, and the lines it picks. Every surface is asked
 * the same filter and must pick these lines. A field added to the schema without a row here fails the test below.
 */
const FILTER_CASES: Record<keyof UnpagedLineFilter, FilterCase[]> = {
  // Text in the source, the translation, the speaker or the key; %, _ are plain characters.
  q: [() => ({ filter: { q: '50%' }, keys: ['a1'] }), () => ({ filter: { q: '하나' }, keys: ['b1'] }), () => ({ filter: { q: 'MIRA_KEY' }, keys: ['a2', 'b3'] }), () => ({ filter: { q: 'e_' }, keys: [] })],
  // A person under every spelling, whichever spelling is asked.
  speakers: [() => ({ filter: { speakers: ['Mira'] }, keys: ['a1', 'a2', 'b2'] }), () => ({ filter: { speakers: ['MIRA_KEY'] }, keys: ['a1', 'a2', 'b2'] }), () => ({ filter: { speakers: ['mira', 'Stranger'] }, keys: ['a1', 'a2', 'b2', 'b3'] }), () => ({ filter: { speakers: ['Nobody'] }, keys: [] })],
  listeners: [() => ({ filter: { listeners: ['Jonas'] }, keys: ['a1'] }), () => ({ filter: { listeners: ['MIRA_KEY'] }, keys: ['a3'] }), () => ({ filter: { listeners: ['-'] }, keys: ['a2', 'b1', 'b2', 'b3'] }), () => ({ filter: { listeners: ['-', 'Jonas'] }, keys: ['a1', 'a2', 'b1', 'b2', 'b3'] })],
  // A whole word of the source, or a {NAME} placeholder, under every spelling.
  mentions: [() => ({ filter: { mentions: ['Mira'] }, keys: ['a3', 'b3', 'd1'] }), () => ({ filter: { mentions: ['Jonas'] }, keys: ['a1'] })],
  groups: [() => ({ filter: { groups: ['Pier'] }, keys: ['a1', 'a2', 'a3', 'a4'] }), () => ({ filter: { groups: ['g2', 'Menu'] }, keys: ['b1', 'b2', 'b3', 'c1', 'c2'] })],
  sections: [() => ({ filter: { sections: ['Ch2'] }, keys: ['b1', 'b2', 'b3'] }), () => ({ filter: { sections: ['UI'], groupKind: 'document' }, keys: ['d1'] })],
  groupKind: [() => ({ filter: { groupKind: 'ui' }, keys: ['c1', 'c2'] }), () => ({ filter: { groupKind: 'scene' }, keys: except('c1', 'c2', 'd1') })],
  kind: [() => ({ filter: { kind: 'document' }, keys: ['d1'] }), () => ({ filter: { kind: 'ui' }, keys: ['c1', 'c2'] })],
  statuses: [({ final }) => ({ filter: { statuses: [final.name] }, keys: ['b1', 'c1'] }), ({ final, review }) => ({ filter: { statuses: [final.id, review.name] }, keys: ['a3', 'b1', 'c1'] })],
  // Every one of the tags.
  tags: [() => ({ filter: { tags: ['A'] }, keys: ['a1', 'a2'] }), () => ({ filter: { tags: ['A', '#B'] }, keys: ['a1'] })],
  marks: [() => ({ filter: { marks: ['diverged'] }, keys: ['b1', 'b2'] }), () => ({ filter: { marks: ['aiSuggestion'] }, keys: ['a4'] })],
  // The work left: not final, and for translation.
  unfinished: [() => ({ filter: { unfinished: true }, keys: except('b1', 'c1', 'c2') }), () => ({ filter: { unfinished: false }, keys: ['b1', 'c1'] })],
  decidedBy: [() => ({ filter: { decidedBy: 'ai' }, keys: ['a3'] }), () => ({ filter: { decidedBy: 'human' }, keys: except('a3') })],
  noted: [() => ({ filter: { noted: true }, keys: ['a2'] }), () => ({ filter: { noted: false }, keys: except('a2') })],
  excluded: [() => ({ filter: { excluded: 'only' }, keys: ['c2'] }), () => ({ filter: { excluded: 'hide' }, keys: except('c2') })],
  // With statuses too, a line must be in both (the review inbox filtered by a status).
  review: [() => ({ filter: { review: true }, keys: ['a3'] }), ({ final, review }) => ({ filter: { review: true, statuses: [final.name, review.name] }, keys: ['a3'] }), ({ final }) => ({ filter: { review: true, statuses: [final.name] }, keys: [] })],
  // Lines nobody speaks are not hidden with a speaker.
  hideSpeakers: [() => ({ filter: { hideSpeakers: ['MIRA_KEY'] }, keys: except('a1', 'a2', 'b2') })],
  hideStatuses: [({ final }) => ({ filter: { hideStatuses: [final.name] }, keys: except('b1', 'c1') })],
  // Any one of the tags.
  hideTags: [() => ({ filter: { hideTags: ['A', 'B'] }, keys: except('a1', 'a2', 'b1') })],
  hideMarks: [() => ({ filter: { hideMarks: ['diverged'] }, keys: except('b1', 'b2') })],
  // Lines to translate with (or without) a translation: 번역 제외 lines are neither.
  translated: [() => ({ filter: { translated: true }, keys: ['b1', 'b2', 'c1'] }), () => ({ filter: { translated: false }, keys: except('b1', 'b2', 'c1', 'c2') })],
  keys: [() => ({ filter: { keys: ['b1', 'a1'] }, keys: ['a1', 'b1'] })],
  ids: [({ id }) => ({ filter: { ids: [id('a2'), id('d1'), 'no-such-id'] }, keys: ['a2', 'd1'] })],
  view: [() => ({ filter: { view: 'Opening' }, keys: ['a1', 'a2'] }), ({ id }) => ({ filter: { view: 'view-opening', keys: ['a2', 'a3'], ids: [id('a1'), id('a2')] }, keys: ['a2'] })],
};

describe('one line filter on every surface', () => {
  const fields = Object.keys(lineFilterSchema.shape).filter((field) => field !== 'offset' && field !== 'limit');

  it('has a case for every field of lineFilterSchema, and the cases reach every field of the resolved filter', async () => {
    expect(Object.keys(FILTER_CASES).sort()).toEqual([...fields].sort());
    const fixture = filterFixture();
    for (const field of fields) expect(FILTER_CASES[field as keyof UnpagedLineFilter].every((make) => field in make(fixture).filter), field).toBe(true);
    // What lineConditions reads is what resolveLineFilter writes: a resolved field no case produces is one nothing checks.
    const produced = new Set<string>();
    for (const cases of Object.values(FILTER_CASES)) for (const make of cases) for (const key of Object.keys(resolveLineFilter(fixture.db, fixture.projectId, make(fixture).filter).filter)) produced.add(key);
    for (const key of Object.keys(resolveLineFilter(fixture.db, fixture.projectId, { view: 'Nothing' }).filter)) produced.add(key);
    expect([...produced].sort()).toEqual(Object.keys(resolvedLineFilterSchema.shape).sort());
  });

  it.each(Object.entries(FILTER_CASES))('%s: the list, its matches, findLines and a run scope pick the same lines', async (_field, cases) => {
    const fixture = filterFixture();
    for (const make of cases) {
      const { filter, keys } = make(fixture);
      const said = JSON.stringify(filter);
      const got = await fixture.surfaces(filter);
      expect(got.list, `list ${said}`).toEqual(keys);
      expect(got.total, `list total ${said}`).toBe(keys.length);
      expect(got.matches, `matches ${said}`).toEqual(keys);
      expect(got.found, `findLines ${said}`).toEqual(keys);
      // A run takes the same lines, less those 번역 제외 keeps out of every run (and says how many).
      expect(got.run, `run scope ${said}`).toEqual(keys.filter((key) => !EXCLUDED.includes(key)));
      expect(got.excluded, `run scope's 번역 제외 ${said}`).toBe(keys.filter((key) => EXCLUDED.includes(key)).length);
      // What a run stores is a resolved filter, whole.
      expect(resolvedLineFilterSchema.parse(got.resolved)).toEqual(got.resolved);
    }
  });

  it('names what the project does not have on every surface, instead of dropping the condition', async () => {
    const fixture = filterFixture();
    const cases: [UnpagedLineFilter, string][] = [
      [{ statuses: ['없는상태'] }, '찾지 못함: 상태 없는상태'],
      [{ tags: ['A', '없는태그'] }, '찾지 못함: 태그 없는태그'],
      [{ hideStatuses: ['없는상태'], hideTags: ['없는태그'] }, '찾지 못함: 상태 없는상태, 태그 없는태그'],
      [{ groups: ['Pier', 'Nowhere'] }, '찾지 못함: 묶음 Nowhere'],
      [{ sections: ['Ch9'] }, '찾지 못함: 구역 Ch9'],
      [{ keys: ['a1', 'zz'] }, '찾지 못함: 대사 zz'],
      [{ view: 'No such view' }, '찾지 못함: 보기 No such view'],
    ];
    for (const [filter, error] of cases) {
      const said = JSON.stringify(filter);
      expect(await fixture.surfaces(filter), said).toEqual({ error, matchesStatus: 400 });
      expect(() => findLines(fixture.db, fixture.projectId, lineFilterSchema.parse(filter)), said).toThrow(error);
      expect(askedScope(fixture.db, fixture.projectId, 'lines', { filter }), said).toEqual({ ok: false, error });
      // Even run as it is, a filter that lost a name matches no line: never more than was asked.
      const { filter: resolved, unknown } = resolveLineFilter(fixture.db, fixture.projectId, filter);
      expect(unknown.length, said).toBeGreaterThan(0);
      expect(selectRunUnits(fixture.db, fixture.projectId, { filter: resolved }), said).toEqual([]);
    }
  });

  it('never reads an empty list as "no condition"', async () => {
    const fixture = filterFixture();
    const { db, projectId, id } = fixture;
    // Asked: an empty list is refused, and so is a field the filter does not have (a typo would otherwise widen it).
    for (const field of ['speakers', 'listeners', 'mentions', 'groups', 'sections', 'statuses', 'tags', 'marks', 'hideSpeakers', 'hideStatuses', 'hideTags', 'hideMarks', 'keys', 'ids']) expect(lineFilterSchema.safeParse({ [field]: [] }).success, field).toBe(false);
    expect(lineFilterSchema.safeParse({ speaker: ['Mira'] }).success).toBe(false);
    // Resolved: a list holds something or is absent; the old scope's names are not read as an empty scope.
    for (const field of ['speakers', 'listeners', 'mentions', 'groupIds', 'sections', 'statusIds', 'tagIds', 'marks', 'hideSpeakers', 'hideStatusIds', 'hideTagIds', 'hideMarks', 'lineIds']) expect(resolvedLineFilterSchema.safeParse({ [field]: [] }).success, field).toBe(false);
    expect(runScopeSchema.safeParse({ unitIds: ['x'] }).success).toBe(false);
    expect(runScopeSchema.safeParse({ filter: { tagIds: [] } }).success).toBe(false);
    // Named lines of which none is left pick no line: keys and ids that share none, a view without lines, ids that are gone.
    for (const filter of [{ keys: ['a1'], ids: [id('a2')] }, { view: 'Nothing' }, { ids: ['gone'] }] satisfies UnpagedLineFilter[]) {
      const got = await fixture.surfaces(filter);
      expect([got.list, got.matches, got.found, got.run], JSON.stringify(filter)).toEqual([[], [], [], []]);
    }
    expect(resolveLineFilter(db, projectId, { view: 'Nothing' }).filter).toEqual({ nothing: true });
    expect(linesById([])).toEqual({ nothing: true });
    expect(selectRunUnits(db, projectId, { filter: linesById([]) })).toEqual([]);
    expect(selectRunUnits(db, projectId, { filter: { nothing: true, statusIds: [fixture.initial.id] } })).toEqual([]);
  });

  it('finds the same lines for text with %, _, \\ and quotes on every surface (a run\'s q is the list\'s search)', async () => {
    const db = openDatabase(':memory:');
    const sources = ['50% done', 'Hello world', 'a_b', 'axb', 'C:\\dir', 'Cdir', 'say "hi"', '100%% sure'];
    const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'P' }, groups: [{ key: 'g', title: 'G' }], units: sources.map((source, n) => ({ key: `u${n}`, group: 'g', source })) }));
    const app = new Hono<Env>().onError(onError)
      .use(async (c, next) => {
        c.set('deps', { db } as never);
        await next();
      })
      .route('/', sourceRoutes);
    const keyOf = (id: string) => db.select({ key: s.units.key }).from(s.units).where(eq(s.units.id, id)).get()!.key;
    const cases: [string, string[]][] = [
      ['%', ['u0', 'u7']],
      ['_', ['u2']],
      ['\\', ['u4']],
      [':\\d', ['u4']],
      ['"hi"', ['u6']],
      ['%%', ['u7']],
      ['Hello', ['u1']],
    ];
    for (const [q, keys] of cases) {
      const body = (await (await app.request(`/projects/${projectId}/units/ids`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filter: { q } }) })).json()) as { ids: string[] };
      expect(body.ids.map(keyOf), q).toEqual(keys);
      expect(findLines(db, projectId, lineFilterSchema.parse({ q })).rows.map((row) => row.key), q).toEqual(keys);
      const scope = askedScope(db, projectId, 'lines', { filter: { q } });
      if (!scope.ok) throw new Error(scope.error);
      expect(selectRunUnits(db, projectId, scope.scope).map(keyOf).sort(), q).toEqual(keys);
    }
  });
});

describe('CLI parity with the app', () => {
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
    const { scope, unknown } = resolveRunScope(db, projectId, { filter: { groups: [group.title, 'nope'], keys: [unit.key], tags: ['no-tag'], marks: ['aiSuggestion'], unfinished: true }, changeHuman: true });
    expect(scope).toMatchObject({ filter: { marks: ['aiSuggestion'], unfinished: true, groupIds: [group.id], lineIds: [unit.id] }, changeHuman: true });
    expect(unknown).toEqual(['묶음 nope', '태그 no-tag']);
    // Everything found: the scope is exactly what a run stores.
    expect(resolveRunScope(db, projectId, { filter: { groups: [group.title], keys: [unit.key] } })).toEqual({ scope: { filter: { groupIds: [group.id], lineIds: [unit.id] } }, unknown: [] });
    expect(resolveRunScope(db, projectId, {})).toEqual({ scope: {}, unknown: [] });
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

  it('reads the relationships and events named by id (what the chat is told to do with an attached one)', async () => {
    const { db, projectId } = setup();
    const person = (name: string) => db.insert(s.characters).values({ projectId, name }).returning().get();
    const [a, b, c] = [person('가'), person('나'), person('다')];
    const relations = [[a, b], [b, c]].map(([from, to]) => db.insert(s.relationships).values({ projectId, fromId: from!.id, toId: to!.id, kind: '동료' }).returning().get());
    const events = ['첫째', '둘째'].map((title) => db.insert(s.storyEvents).values({ projectId, title }).returning().get());
    const run = (name: string, input: object) => agentCatalog(db, projectId).find((tool) => tool.name === name)!.run(input) as Promise<{ id: string }[]>;
    expect((await run('list_relationships', { ids: [relations[1]!.id] })).map((row) => row.id)).toEqual([relations[1]!.id]);
    expect((await run('list_relationships', {})).map((row) => row.id).sort()).toEqual(expect.arrayContaining(relations.map((row) => row.id)));
    expect((await run('list_events', { ids: [events[0]!.id] })).map((row) => row.id)).toEqual([events[0]!.id]);
    expect((await run('list_events', {})).map((row) => row.id)).toEqual(expect.arrayContaining(events.map((row) => row.id)));
  });
});
