import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { importFileSchema, ISSUE_KINDS, workflowDefinitionSchema, type ExitAction } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { issueTagIds } from '../services/issue-tags.ts';
import { snapshotWorkflowModels } from '../services/model-target.ts';
import { runProgress } from '../services/run-detail.ts';
import { memoryStore } from '../services/secrets.ts';
import { HUMAN_OWNED_NOTE } from './apply-candidate.ts';
import { applyExitActions, HUMAN_STATUS_NOTE } from './exit-actions.ts';
import { subjectOf } from './subjects.ts';
import { createRun } from './run-create.ts';
import { Runner, type ModelPort } from './runner.ts';

const at = { x: 0, y: 0 };
const noModel: ModelPort = { ask: async () => { throw new Error('unused'); }, generate: async () => { throw new Error('unused'); } };

/** A project of `lines` lines (a1 by Alice, the rest by Bob), with the starter tags and statuses. */
function setup(lines = 2) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: lines }, (_, index) => ({ key: `a${index + 1}`, group: 'g1', speaker: index === 0 ? 'Alice' : 'Bob', source: `Line ${index + 1}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Harbor' }], units }), choice);
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const initial = statuses.find((status) => status.kind === 'initial')!;
  const confirmed = statuses.find((status) => status.kind === 'final')!;
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();
  const urgent = db.insert(s.tags).values({ projectId, name: '긴급', color: '#ff0000', scope: ['lines'] }).returning().get();
  return { db, projectId, choice, initial, confirmed, review, urgent, issues: issueTagIds(db, projectId) };
}
type Ctx = ReturnType<typeof setup>;

const tag = (tagIds: string[], extra: Partial<Extract<ExitAction, { type: 'tag' }>> = {}): ExitAction => ({ type: 'tag', action: 'add', tagIds, categoryTags: {}, ...extra });
const untag = (tagIds: string[]): ExitAction => tag(tagIds, { action: 'remove' });
const status = (statusId: string): ExitAction => ({ type: 'status', statusId });

/** Nodes by id with edges "from.port -> to"; every flow has an entry, and "-> end" is an exit with nothing after it. */
const flow = (nodes: Record<string, object>, edges: string[]) =>
  workflowDefinitionSchema.parse({
    nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, ...Object.entries(nodes).map(([id, node]) => ({ id, ...node }))],
    edges: edges.filter((edge) => !edge.endsWith(' -> end')).map((edge, index) => {
      const [from, to] = edge.split(' -> ');
      const [source, sourceHandle = 'out'] = from!.split('.');
      return { id: String(index), source: source!, sourceHandle, target: to! };
    }),
  });
/** A condition node (ports true / false) with actions on its exits. */
const cond = (expression: unknown, exits: Record<string, ExitAction[]> = {}) => ({ type: 'condition', position: at, config: { expression }, exits });
const always = { '==': [1, 1] };
/** A script node that answers with `data` (its result for the exits' `fromField`), or throws. */
const script = (body: string, exits: Record<string, ExitAction[]> = {}) => ({ type: 'function', position: at, config: { fn: 'script', params: { ports: ['out'], code: `export default function run(input) { ${body} }` } }, exits });

const start = (ctx: Ctx, definition: ReturnType<typeof flow>, scope: s.RunScope = {}) => {
  const workflow = ctx.db.insert(s.workflows).values({ projectId: ctx.projectId, name: 'test', definition }).returning().get();
  return createRun(ctx.db, { projectId: ctx.projectId, workflow, models: snapshotWorkflowModels(ctx.db, workflow.definition), scope }).runId;
};
const drain = async (ctx: Ctx, runId: string) => {
  const runner = new Runner(ctx.db, memoryStore(), noModel);
  await runner.drain();
  return { items: ctx.db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all(), runner };
};
const unitOf = (ctx: Ctx, key: string) => ctx.db.select().from(s.units).where(eq(s.units.key, key)).get()!;
const tagNamesOf = (ctx: Ctx, key: string) => {
  const tags = ctx.db.select().from(s.tags).all();
  return ctx.db.select().from(s.unitTags).where(eq(s.unitTags.unitId, unitOf(ctx, key).id)).all().map((row) => tags.find((entry) => entry.id === row.tagId)!.name).sort();
};
/** Counts every write of a line's status (also one that sets what it already is) in `status_writes`. */
function countStatusWrites(ctx: Ctx) {
  ctx.db.run(sql`create table status_writes (unit_id text not null)`);
  ctx.db.run(sql`create trigger count_status_writes after update of status_id on units begin insert into status_writes values (new.id); end`);
  return (key: string) => ctx.db.all<{ n: number }>(sql`select count(*) as n from status_writes where unit_id = ${unitOf(ctx, key).id}`)[0]!.n;
}

describe('exit actions in a run', () => {
  it('apply in the order they are listed, as the line leaves the exit', async () => {
    const ctx = setup();
    const { urgent, confirmed, review } = ctx;
    const later = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '나중', color: '#00ff00', scope: ['lines'] }).returning().get();
    // Put on, taken off again, another put on; two statuses: the last one stays.
    const runId = start(ctx, flow({ c: cond(always, { true: [tag([urgent.id]), untag([urgent.id]), tag([later.id]), status(review.id), status(confirmed.id)] }) }, ['entry -> c', 'c.true -> end']));
    const { items } = await drain(ctx, runId);
    expect(items.map((item) => item.state)).toEqual(['done', 'done']);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['나중']);
    // Taken off first, then put on: it stays.
    const second = start(ctx, flow({ c: cond(always, { true: [untag([urgent.id]), tag([urgent.id])] }) }, ['entry -> c', 'c.true -> end']));
    await drain(ctx, second);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '나중']);
    const unit = unitOf(ctx, 'a1');
    expect([unit.statusId, unit.statusBy, unit.statusRunId]).toEqual([confirmed.id, 'ai', runId]);
    // The line's history has each change, by the run that did it (taking off a tag it lacks is none; event_actor is cleared after).
    const events = ctx.db.select().from(s.lineEvents).where(eq(s.lineEvents.unitId, unit.id)).all();
    expect(events.filter((event) => event.kind === 'tag').map((event) => event.runId)).toEqual([runId, runId, runId, second]);
    expect(events.filter((event) => event.kind === 'status').map((event) => event.runId)).toEqual([runId, runId]);
    expect(ctx.db.select().from(s.eventActor).all()).toEqual([]);
  });

  it('are applied once, before the exit\'s lines split: every branch sees the tag and the new status', async () => {
    const ctx = setup(1);
    const { urgent, confirmed } = ctx;
    const writes = countStatusWrites(ctx);
    const sees = { in: [urgent.id, { var: 'unit.tagIds' }] };
    const definition = flow(
      { c: cond(always, { true: [tag([urgent.id]), status(confirmed.id)] }), a: cond(sees), b: cond({ '==': [{ var: 'unit.statusId' }, confirmed.id] }) },
      ['entry -> c', 'c.true -> a', 'c.true -> b', 'a.true -> end', 'b.true -> end'],
    );
    const { items } = await drain(ctx, start(ctx, definition));
    // One copy of the line per branch, each having left the exit with both actions done.
    expect(items.map((item) => item.state)).toEqual(['done', 'done']);
    expect(items.map((item) => item.data.path.map((step) => `${step.nodeId}:${step.port}`).filter((step) => /^[ab]:/.test(step))).sort()).toEqual([['a:true'], ['b:true']]);
    expect(writes('a1')).toBe(1);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
  });

  it('are applied again on each pass of a loop, and are not visits', async () => {
    const ctx = setup(1);
    const { urgent, confirmed } = ctx;
    const writes = countStatusWrites(ctx);
    // Two passes through the true exit, the third visit leaves by false (which has no actions).
    const definition = flow({ c: cond({ '<': [{ var: 'visits.c' }, 3] }, { true: [tag([urgent.id]), status(confirmed.id)] }) }, ['entry -> c', 'c.true -> c', 'c.false -> end']);
    const { items } = await drain(ctx, start(ctx, definition));
    expect(items.map((item) => item.state)).toEqual(['done']);
    expect(writes('a1')).toBe(2);
    expect(items[0]!.visits.c).toBe(3);
    // Only nodes are visited: the actions on the exit left no count of their own.
    expect(Object.keys(items[0]!.visits).sort()).toEqual(['c', 'entry']);
  });

  it('keep a person\'s status and translation in a status-filtered run, and report it; a run without the filter changes it', async () => {
    const ctx = setup(1);
    const { initial, confirmed, urgent } = ctx;
    const definition = flow({ c: cond(always, { true: [tag([urgent.id]), status(confirmed.id)] }) }, ['entry -> c', 'c.true -> end']);
    const runId = start(ctx, definition, { filter: { statusIds: [initial.id] } });
    // A person saved '내 번역' after the run started (#51).
    ctx.db.update(s.units).set({ translation: '내 번역', statusBy: 'human' }).where(eq(s.units.id, unitOf(ctx, 'a1').id)).run();
    const { items, runner } = await drain(ctx, runId);
    const unit = unitOf(ctx, 'a1');
    expect([unit.translation, unit.statusBy, unit.statusId]).toEqual(['내 번역', 'human', initial.id]);
    // The tag is not the person's to protect; the status is.
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
    expect(items[0]!.state).toBe('done');
    expect(items[0]!.data.exitNotes).toEqual([{ at: 'c:true', note: HUMAN_OWNED_NOTE }]);
    expect(runProgress(ctx.db, runner, ctx.projectId, [runId])[0]!.exits['c:true']).toEqual({ notes: { [HUMAN_OWNED_NOTE]: 1 } });

    // The same line in a run that names its lines (no status filter) is asked to be rewritten: its status goes through.
    const named = await drain(ctx, start(ctx, definition, { unitIds: [unit.id] } as s.RunScope));
    expect(named.items.find((item) => item.runId !== runId)?.data.exitNotes).toBeUndefined();
    expect(unitOf(ctx, 'a1').statusId).toBe(confirmed.id);
  });

  it('leave a status a person set and a tag a person put on, unless the run is asked to change them too (S6)', async () => {
    const ctx = setup(1);
    const { review, confirmed, urgent } = ctx;
    const line = unitOf(ctx, 'a1');
    // A person marks the line for another look: 검토 필요 and a tag.
    ctx.db.update(s.units).set({ statusId: review.id, statusBy: 'human' }).where(eq(s.units.id, line.id)).run();
    ctx.db.insert(s.unitTags).values({ unitId: line.id, tagId: urgent.id }).run();
    const pass = flow({ c: cond(always, { true: [untag([urgent.id]), status(confirmed.id)] }) }, ['entry -> c', 'c.true -> end']);
    const kept = start(ctx, pass);
    const { runner } = await drain(ctx, kept);
    expect(unitOf(ctx, 'a1').statusId).toBe(review.id);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
    expect(runProgress(ctx.db, runner, ctx.projectId, [kept])[0]!.exits['c:true']).toEqual({ notes: { '사람이 붙인 태그 ‘긴급’는 떼지 않았습니다.': 1, [HUMAN_STATUS_NOTE]: 1 } });
    // Asked to change them too: they change.
    const changed = start(ctx, pass, { changeHuman: true });
    await drain(ctx, changed);
    expect(unitOf(ctx, 'a1').statusId).toBe(confirmed.id);
    expect(tagNamesOf(ctx, 'a1')).toEqual([]);
  });

  it('skip a tag name an AI made up (and say so) instead of creating it, and put on the ones the project has', async () => {
    const ctx = setup(1);
    const { issues, urgent } = ctx;
    const pick = script('return { data: { categories: ["speech", "긴급", "없는 태그"] } };', { out: [tag([], { fromField: 'categories', categoryTags: { speech: issues.speech! } })] });
    const tagsBefore = ctx.db.select().from(s.tags).all().length;
    const runId = start(ctx, flow({ pick }, ['entry -> pick', 'pick -> end']));
    const { items, runner } = await drain(ctx, runId);
    expect(items.map((item) => item.state)).toEqual(['done']);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', ISSUE_KINDS.speech.name].sort());
    expect(ctx.db.select().from(s.tags).all()).toHaveLength(tagsBefore);
    expect(items[0]!.data.exitNotes).toEqual([{ at: 'pick:out', note: '없는 태그 이름: 없는 태그' }]);
    expect(runProgress(ctx.db, runner, ctx.projectId, [runId])[0]!.exits['pick:out']).toEqual({ notes: { '없는 태그 이름: 없는 태그': 1 } });
    expect(urgent.name).toBe('긴급');
  });

  it('make again a tag deleted while the run goes on, from what the run noted when it started', async () => {
    const ctx = setup(2);
    const { urgent } = ctx;
    const runId = start(ctx, flow({ c: cond(always, { true: [tag([urgent.id])] }) }, ['entry -> c', 'c.true -> end']));
    expect(ctx.db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.tags).toEqual([expect.objectContaining({ id: urgent.id, name: '긴급', color: '#ff0000' })]);
    ctx.db.delete(s.tags).where(eq(s.tags.id, urgent.id)).run();
    const { items } = await drain(ctx, runId);
    expect(items.map((item) => item.state)).toEqual(['done', 'done']);
    // The same tag (id, name, colour), once, on both lines.
    expect(ctx.db.select().from(s.tags).where(eq(s.tags.id, urgent.id)).all()).toEqual([expect.objectContaining({ name: '긴급', color: '#ff0000' })]);
    expect([tagNamesOf(ctx, 'a1'), tagNamesOf(ctx, 'a2')]).toEqual([['긴급'], ['긴급']]);
  });

  it('end a line that left through an 오류 exit that sets a status (and no edge) as done; tags alone keep it failed', async () => {
    const ctx = setup(1);
    const { issues, review } = ctx;
    const failing = (exits: Record<string, ExitAction[]>) => flow({ boom: script('throw new Error("boom");', exits) }, ['entry -> boom']);
    const { items } = await drain(ctx, start(ctx, failing({ error: [tag([issues.aiFailed!]), status(review.id)] })));
    expect(items[0]!.state).toBe('done');
    expect(items[0]!.error).toBeNull();
    expect(items[0]!.data.error).toBeUndefined();
    expect(tagNamesOf(ctx, 'a1')).toEqual([ISSUE_KINDS.aiFailed.name]);
    expect(unitOf(ctx, 'a1').statusId).toBe(review.id);

    // The same exit without actions leaves the failure on the line.
    const bare = setup(1);
    const failed = await drain(bare, start(bare, failing({})));
    expect(failed.items[0]!.state).toBe('failed');
    expect(failed.items[0]!.error).toContain('boom');

    // Tags alone only mark it: the line still ends failed ('실패한 줄 다시' offers it), tagged.
    const tagged = setup(1);
    const marked = await drain(tagged, start(tagged, failing({ error: [tag([tagged.issues.aiFailed!])] })));
    expect(marked.items[0]!.state).toBe('failed');
    expect(marked.items[0]!.error).toContain('boom');
    expect(tagNamesOf(tagged, 'a1')).toEqual([ISSUE_KINDS.aiFailed.name]);
  });

  it('set a term\'s status in a term workflow, and refuse a line status there', async () => {
    const ctx = setup(1);
    const term = ctx.db.insert(s.terms).values({ projectId: ctx.projectId, source: 'Varn Gate', status: 'candidate', origin: 'script', statusBy: 'ai', examples: [] }).returning().get();
    const place = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '지명', color: '#000000', scope: ['terms'] }).returning().get();
    const terms = (exits: Record<string, ExitAction[]>) => workflowDefinitionSchema.parse({ ...flow({ c: cond(always, exits) }, ['entry -> c', 'c.true -> end']), nodes: flow({ c: cond(always, exits) }, []).nodes.map((node) => (node.type === 'entry' ? { ...node, config: { input: 'terms' } } : node)) });
    const { items } = await drain(ctx, start(ctx, terms({ true: [status('confirmed'), tag([place.id])] })));
    expect(items.map((item) => item.state)).toEqual(['done']);
    const row = ctx.db.select().from(s.terms).where(eq(s.terms.id, term.id)).get()!;
    expect([row.status, row.statusBy]).toEqual(['confirmed', 'ai']);
    expect(ctx.db.select().from(s.knowledgeTags).where(eq(s.knowledgeTags.itemId, term.id)).all().map((entry) => entry.tagId)).toEqual([place.id]);

    // A line status is not a term status: the action cannot be done, and the line fails there (not through the 오류 exit).
    const wrong = await drain(ctx, start(ctx, terms({ true: [status(ctx.confirmed.id)], error: [tag([place.id])] })));
    expect(wrong.items.filter((item) => item.state === 'failed')).toHaveLength(1);
    expect(wrong.items.find((item) => item.state === 'failed')!.error).toContain('출구 동작을 하지 못했습니다');
  });

  it('note in the run\'s progress, by exit, what could not be done (an exit that did all it was asked has no entry)', async () => {
    const ctx = setup(3);
    const { initial, confirmed } = ctx;
    // a1 (Alice) leaves by true, a2 and a3 (Bob) by false; a person saved a2 meanwhile.
    const definition = flow({ c: cond({ '==': [{ var: 'unit.speaker' }, 'Alice'] }, { true: [status(confirmed.id)], false: [status(confirmed.id)] }) }, ['entry -> c', 'c.true -> end', 'c.false -> end']);
    const runId = start(ctx, definition, { filter: { statusIds: [initial.id] } });
    ctx.db.update(s.units).set({ translation: '내 번역', statusBy: 'human' }).where(eq(s.units.id, unitOf(ctx, 'a2').id)).run();
    const { runner } = await drain(ctx, runId);
    const { exits } = runProgress(ctx.db, runner, ctx.projectId, [runId])[0]!;
    expect(exits['entry:out']).toBeUndefined();
    expect(exits['c:true']).toBeUndefined();
    expect(exits['c:false']).toEqual({ notes: { [HUMAN_OWNED_NOTE]: 1 } });
    expect([unitOf(ctx, 'a1').statusId, unitOf(ctx, 'a2').statusId, unitOf(ctx, 'a3').statusId]).toEqual([confirmed.id, initial.id, confirmed.id]);
  });
});

/** applyExitActions on one line, as the runner calls it: the result of the AI node `ai` before the exit `ai:out`. */
function applyTo(ctx: Ctx, actions: ExitAction[], output: Record<string, unknown> | undefined, key = 'a1') {
  const definition = flow({ ai: { type: 'ai', position: at, config: { model: ctx.choice, instructions: 'x' } } }, ['entry -> ai', 'ai -> end']);
  const run = { id: 'r', projectId: ctx.projectId, scope: {}, tags: [], definition };
  const item = { subjectId: unitOf(ctx, key).id, data: { path: [{ nodeId: 'entry', port: 'out', at: 0 }], outputs: (output ? { ai: output } : {}) as Record<string, Record<string, unknown>> } };
  return ctx.db.transaction((tx) => applyExitActions(tx, run, item, 'ai', 'out', actions, subjectOf('lines').exitActions));
}
const customTags = (ctx: Ctx) => ctx.db.select().from(s.tags).all().filter((entry) => !Object.values(ISSUE_KINDS).some((kind) => kind.name === entry.name));

describe('tag exit actions', () => {
  it('put on tags by the name an AI result gives and never create a tag', () => {
    const ctx = setup();
    const params = { fromField: 'value' };
    expect(applyTo(ctx, [tag([], params)], { value: '긴급' })).toEqual([]);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
    expect(applyTo(ctx, [tag([], params)], { value: '없는 태그' }, 'a2')).toEqual(['없는 태그 이름: 없는 태그']);
    expect(tagNamesOf(ctx, 'a2')).toEqual([]);
    expect(customTags(ctx)).toHaveLength(1);
  });

  it('add and remove the tags picked in the pane: a finding tag is picked like any other', () => {
    const ctx = setup();
    const { urgent, issues } = ctx;
    expect(applyTo(ctx, [tag([urgent.id, issues.format!])], undefined)).toEqual([]);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '형식 오류']);
    applyTo(ctx, [untag([urgent.id])], undefined);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['형식 오류']);
    expect(customTags(ctx)).toHaveLength(1);
    // An action with nothing to put on does nothing (validation says so before a run).
    expect(applyTo(ctx, [tag([])], { x: 1 })).toEqual([]);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['형식 오류']);
  });

  it('turn the values of a result field into tags: the tag its category is connected to, else the tag of that name; none is made', () => {
    const ctx = setup();
    const { issues } = ctx;
    const categories = tag([], { fromField: 'categories', categoryTags: { speech: issues.speech!, term: issues.term! } });
    expect(applyTo(ctx, [categories], { categories: ['speech', 'term', '긴급', '없는 태그'] })).toEqual(['없는 태그 이름: 없는 태그']);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '말투 어긋남', '용어 위반']);
    expect(customTags(ctx).map((entry) => entry.name)).toEqual(['긴급']);
    // Only unknown names: nothing is put on. No result at all: nothing to read.
    expect(applyTo(ctx, [categories], { categories: ['없는 태그'] }, 'a2')).toEqual(['없는 태그 이름: 없는 태그']);
    expect(applyTo(ctx, [categories], undefined, 'a2')).toEqual([]);
    expect(tagNamesOf(ctx, 'a2')).toEqual([]);
    // A single text field works too (a check's kind).
    applyTo(ctx, [tag([], { action: 'remove', fromField: 'kind', categoryTags: { speech: issues.speech! } })], { kind: 'speech' });
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어 위반']);
  });

  it('a pass-path 떼기 removes only the tags it names and leaves another check\'s and the person\'s', () => {
    const ctx = setup();
    const { urgent, issues } = ctx;
    applyTo(ctx, [tag([urgent.id, issues.format!, issues.term!])], undefined);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어 위반', '형식 오류']);
    applyTo(ctx, [untag([issues.format!])], { kind: 'format', passed: true });
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급', '용어 위반']);
    applyTo(ctx, [untag(Object.values(issues))], undefined);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
  });

  it('skip a tag that may not go on lines, with a note', () => {
    const ctx = setup();
    const place = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '지명', color: '#000000', scope: ['terms'] }).returning().get();
    expect(applyTo(ctx, [tag([place.id, ctx.urgent.id])], undefined)).toEqual(['‘지명’ 태그는 대사에 붙일 수 없어 붙이지 않았습니다.']);
    expect(tagNamesOf(ctx, 'a1')).toEqual(['긴급']);
  });
});
