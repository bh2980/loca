import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { importFileSchema, lineChangeSchema, workflowDefinitionSchema, type ExitAction } from '@tw/shared';
import { onError, type Env } from '../context.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { createRun } from '../engine/run-create.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { addCandidate } from '../services/candidates.ts';
import { proposeChange, undoChanges } from '../services/change-gate.ts';
import { deleteLines } from '../services/graph-edit.ts';
import { importProject } from '../services/importer.ts';
import { FINAL_NEEDS_TEXT, LINE_CHANGED } from '../services/line-save.ts';
import { snapshotWorkflowModels } from '../services/model-target.ts';
import { decideProposal } from '../services/proposals.ts';
import { memoryStore } from '../services/secrets.ts';
import { undoRecorded } from '../services/undo-records.ts';
import { knowledgeRoutes } from './knowledge.ts';
import { sourceRoutes } from './source.ts';

/**
 * One write path per kind of change: every rule below is exercised through two surfaces (the app's routes, the
 * agent's tools through the change gate, a run), which must answer the same.
 */

const FILE = importFileSchema.parse({
  format: 'loca/v1',
  project: { name: 'P' },
  groups: [{ key: 'g', title: 'Harbor' }],
  units: ['a', 'b', 'c', 'd'].map((key) => ({ key, group: 'g', speaker: key === 'a' ? 'Mira' : 'Kai', source: `Line ${key}.` })),
  characters: [{ name: 'Mira' }, { name: 'Kai' }],
  graph: { nodes: ['a', 'b', 'c', 'd'].map((key) => ({ key: `n${key}`, units: [key] })), edges: [{ from: 'na', to: 'nb', label: 'Ask' }, { from: 'nb', to: 'nc' }] },
});

function setup(mode: 'ask' | 'bypass' = 'bypass', db = openDatabase(':memory:')) {
  const { projectId } = importProject(db, FILE);
  const project = db.select().from(s.projects).where(eq(s.projects.id, projectId)).get()!;
  // Deleting is off for the agent until a person switches it on; here the write paths are under test.
  db.update(s.projects).set({ agentSettings: { ...project.agentSettings, permissions: { script: { delete: true }, scenes: { delete: true }, characters: { delete: true }, relationships: { delete: true } } } }).where(eq(s.projects.id, projectId)).run();
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', permissionMode: mode }).returning().get();
  const app = new Hono<Env>().onError(onError)
    .use(async (c, next) => {
      c.set('deps', { db } as never);
      await next();
    })
    .route('/', sourceRoutes)
    .route('/projects/:projectId', knowledgeRoutes);
  const request = async (method: string, url: string, body?: unknown) => {
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    // A refusal answers `{ error }` (context.ts, onError): `text` is what it says.
    return { status: response.status, text: response.ok ? text : String((JSON.parse(text) as { error?: unknown }).error ?? text), body: (response.ok ? JSON.parse(text) : {}) as Record<string, any> };
  };
  /** The app: a request to one of the project's routes. */
  const send = (method: string, url: string, body?: unknown) => request(method, `/projects/${projectId}${url}`, body);
  /** The app: a request to one line's own routes (its save, its pane's patch), which name no project. */
  const line = (method: string, url: string, body?: unknown) => request(method, `/units/${url}`, body);
  /** The agent: a tool called through the change gate, in this conversation's permission mode. */
  const tool = async (name: string, input: Record<string, unknown>) => {
    const gate = await proposeChange(db, { projectId, sessionId: chat.id, source: 'api', tool: name, input });
    return gate as typeof gate & { result?: Record<string, any>; proposalId?: string };
  };
  const unit = (key: string) => db.select().from(s.units).where(and(eq(s.units.projectId, projectId), eq(s.units.key, key))).get()!;
  const node = (key: string) => db.select().from(s.graphNodes).where(and(eq(s.graphNodes.projectId, projectId), eq(s.graphNodes.key, key))).get();
  const person = (name: string) => db.select().from(s.characters).where(and(eq(s.characters.projectId, projectId), eq(s.characters.name, name))).get()!;
  const status = (kind: 'initial' | 'final') => db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, kind))).get()!;
  /** The graph's lines as "from>to:label", by node key. */
  const ways = () => {
    const keyOf = new Map(db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((row) => [row.id, row.key]));
    return db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().map((edge) => `${keyOf.get(edge.fromId)}>${keyOf.get(edge.toId)}${edge.label ? `:${edge.label}` : ''}`).sort();
  };
  return { db, projectId, chat, send, line, tool, unit, node, person, status, ways };
}
type Ctx = ReturnType<typeof setup>;

describe('knowledge is saved by one service, for the app and the agent', () => {
  it('a relationship\'s ends must be people of this project, named by id (the app) or by name (the agent)', async () => {
    const { db, projectId, send, tool, person } = setup();
    const other = db.insert(s.projects).values({ name: 'Other', sourceLanguage: 'en', targetLanguage: 'ko' }).returning().get();
    const stranger = db.insert(s.characters).values({ projectId: other.id, name: 'Stranger' }).returning().get();

    const refused = await send('POST', '/relationships', { fromId: person('Mira').id, toId: stranger.id, kind: '동료' });
    expect([refused.status, refused.text]).toEqual([400, expect.stringContaining('이 프로젝트에 없는 인물')]);
    const made = await send('POST', '/relationships', { fromId: person('Mira').id, toId: person('Kai').id, kind: '동료' });
    expect(made.status).toBe(201);
    // Moving an end is held to the same rule.
    expect((await send('PATCH', `/relationships/${made.body.id}`, { toId: stranger.id })).status).toBe(400);
    expect(await tool('save_relationship', { from: 'Mira', to: 'Stranger', kind: '동료' })).toMatchObject({ ok: true, status: 'failed', result: { ok: false, error: expect.stringContaining('인물을 먼저 만들어야 합니다') } });
    expect(db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all()).toMatchObject([{ id: made.body.id, toId: person('Kai').id }]);
    // A relationship of another project is not there to change.
    expect((await send('PATCH', '/relationships/nope', { kind: 'x' })).status).toBe(404);
  });

  it('a confirmed relationship confirms its people, whoever saves or confirms it', async () => {
    const { db, projectId, send, tool } = setup();
    const draft = (name: string) => db.insert(s.characters).values({ projectId, name, status: 'candidate', statusBy: 'ai', origin: 'ai' }).returning().get();
    const [a, b, c, d, e, f] = ['A', 'B', 'C', 'D', 'E', 'F'].map(draft);
    const people = (...ids: string[]) => ids.map((id) => db.select({ status: s.characters.status, statusBy: s.characters.statusBy }).from(s.characters).where(eq(s.characters.id, id)).get());

    // The app: a person saved it, so a person confirmed its people.
    expect((await send('POST', '/relationships', { fromId: a!.id, toId: b!.id, kind: '남매' })).status).toBe(201);
    expect(people(a!.id, b!.id)).toEqual([{ status: 'confirmed', statusBy: 'human' }, { status: 'confirmed', statusBy: 'human' }]);
    // The agent, applied by the permission mode: AI decided both.
    expect(await tool('save_relationship', { from: 'C', to: 'D', kind: '동료' })).toMatchObject({ applied: true });
    expect(people(c!.id, d!.id)).toEqual([{ status: 'confirmed', statusBy: 'ai' }, { status: 'confirmed', statusBy: 'ai' }]);
    // A candidate relationship leaves its people as they are, until it is confirmed.
    const candidate = await send('POST', '/relationships', { fromId: e!.id, toId: f!.id, kind: '앙숙', status: 'candidate' });
    expect(people(e!.id, f!.id)).toEqual([{ status: 'candidate', statusBy: 'ai' }, { status: 'candidate', statusBy: 'ai' }]);
    expect((await send('POST', '/drafts', { kind: 'relationships', ids: [candidate.body.id], action: 'confirm' })).body).toEqual({ changed: 1 });
    expect(people(e!.id, f!.id)).toEqual([{ status: 'confirmed', statusBy: 'human' }, { status: 'confirmed', statusBy: 'human' }]);
  });

  it('answers a save with the saved item and its tags, and a patch changes only what was sent', async () => {
    const { db, send } = setup();
    const created = await send('POST', '/events', { title: '난파', participants: ['Mira'] });
    expect(created).toMatchObject({ status: 201, body: { title: '난파', participants: ['Mira'], origin: 'human', statusBy: 'human', tags: [] } });
    db.update(s.storyEvents).set({ statusBy: 'ai', reviewNote: '확인' }).where(eq(s.storyEvents.id, created.body.id)).run();
    const patched = await send('PATCH', `/events/${created.body.id}`, { summary: '배가 가라앉았다' });
    // A person's edit makes the status theirs and takes 확인 권장 off, as the agent's save does for its saver.
    expect(patched.body).toMatchObject({ ok: true, title: '난파', participants: ['Mira'], summary: '배가 가라앉았다', statusBy: 'human', reviewNote: '' });
    expect((await send('PATCH', '/events/nope', { summary: 'x' })).status).toBe(404);
  });
});

describe('lines are created and deleted by one service', () => {
  it('a new line starts the same way from the script list, the graph editor and the agent', async () => {
    const { db, projectId, send, tool, unit, node, status } = setup();
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const line = { source: 'New line.', speaker: 'Mira', listener: 'Kai' };

    expect((await send('POST', '/units', { groupId: group.id, key: 'app', ...line })).status).toBe(201);
    expect((await send('POST', `/graph/nodes/${node('nd')!.id}/after`, { key: 'graph', ...line })).status).toBe(201);
    expect(await tool('create_unit', { groupId: group.id, key: 'agent', ...line })).toMatchObject({ applied: true, result: { ok: true, key: 'agent' } });

    for (const key of ['app', 'graph', 'agent']) {
      const row = unit(key);
      // The project's initial status, no translation, and a graph node of its own that says it was added by hand.
      expect(row, key).toMatchObject({ kind: 'dialogue', statusId: status('initial').id, translation: null, speaker: 'Mira', listener: 'Kai' });
      expect(node(`entry-${row.id}`), key).toMatchObject({ unitIds: [row.id], meta: { manualSourceEntry: true }, origin: key === 'agent' ? 'ai' : 'human' });
    }
    // The listener a save names is a person's only when a person made the save.
    expect([unit('app'), unit('graph'), unit('agent')].map((row) => [row.listenerOrigin, row.listenerConfidence])).toEqual([['human', null], ['human', null], ['ai', 1]]);

    // A key is the line's own in the project, whichever way it is added.
    for (const refused of [await send('POST', '/units', { groupId: group.id, key: 'a', source: 'x' }), await send('POST', `/graph/nodes/${node('nd')!.id}/after`, { key: 'a', source: 'x' })])
      expect([refused.status, refused.text]).toEqual([400, expect.stringContaining('이미 사용 중인 키입니다: a')]);
    expect(await tool('create_unit', { groupId: group.id, key: 'a', source: 'x' })).toMatchObject({ status: 'failed', result: { error: expect.stringContaining('이미 사용 중인 키입니다: a') } });
  });

  it('a deleted line leaves the graph and the knowledge evidence the same way from the script list and the agent', async () => {
    const outcomes = [];
    for (const surface of ['app', 'agent'] as const) {
      const { db, projectId, send, tool, unit, node, ways } = setup();
      const event = db.insert(s.storyEvents).values({ projectId, title: 'E', evidence: ['a', 'b'] }).returning().get();
      if (surface === 'app') expect((await send('DELETE', `/units/${unit('b').id}`)).body).toMatchObject({ deleted: 1, nodes: 1 });
      else expect(await tool('delete_lines', { keys: ['b'], bridge: true })).toMatchObject({ applied: true, result: { ok: true, deleted: 1, nodes: 1 } });
      outcomes.push({ ways: ways(), node: node('nb'), evidence: db.select().from(s.storyEvents).where(eq(s.storyEvents.id, event.id)).get()!.evidence, lines: db.select({ key: s.units.key, seq: s.units.seq }).from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.seq).all() });
    }
    // The line's node went with it and the way through it is kept; the line is evidence of nothing.
    expect(outcomes[0]).toEqual({ ways: ['na>nc:Ask'], node: undefined, evidence: ['a'], lines: [{ key: 'a', seq: 0 }, { key: 'c', seq: 1 }, { key: 'd', seq: 2 }] });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });
});

/** Everything that hangs from line b, as stored. */
function lineB(ctx: Ctx) {
  const { db, projectId, unit, ways } = ctx;
  const row = unit('b') as ReturnType<Ctx['unit']> | undefined;
  return {
    line: row,
    candidates: row ? db.select().from(s.candidates).where(eq(s.candidates.unitId, row.id)).all() : [],
    tags: row ? db.select().from(s.unitTags).where(eq(s.unitTags.unitId, row.id)).all() : [],
    history: row ? db.select().from(s.lineEvents).where(eq(s.lineEvents.unitId, row.id)).all() : [],
    runItems: row ? db.select().from(s.runItems).where(eq(s.runItems.subjectId, row.id)).all() : [],
    nodes: db.select().from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().sort((x, y) => x.key.localeCompare(y.key)),
    edges: db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().sort((x, y) => x.id.localeCompare(y.id)),
    ways: ways(),
    evidence: db.select({ evidence: s.storyEvents.evidence }).from(s.storyEvents).where(eq(s.storyEvents.projectId, projectId)).all(),
  };
}

/** Gives line b a translation, a tag, a memo, a run item and a place in an event's evidence. */
async function dressLineB(ctx: Ctx) {
  const { db, projectId, line, unit } = ctx;
  const b = unit('b');
  await line('POST', `${b.id}/save`, { text: '두 번째 줄.' });
  const tag = db.insert(s.tags).values({ projectId, name: '긴급', color: '#ff0000', scope: ['lines'] }).returning().get();
  await line('PATCH', b.id, { tagIds: [tag.id], note: '확인 필요' });
  const run = db.insert(s.runs).values({ projectId, workflowName: '번역', workflowVersion: 1, definition: { nodes: [], edges: [], settings: {} } as never, scope: {}, status: 'completed', total: 1 }).returning().get();
  db.insert(s.runItems).values({ runId: run.id, subjectId: b.id, nodeId: 'entry', state: 'done', visits: {}, data: { path: [] } as never }).run();
  db.insert(s.storyEvents).values({ projectId, title: 'E', evidence: ['a', 'b'] }).run();
  const before = lineB(ctx);
  // The fixture is worth undoing: a text, a tag, history of both and of the memo, a run item.
  expect([before.candidates.length, before.tags.length, before.history.map((event) => event.kind).sort(), before.runItems.length]).toEqual([1, 1, ['note', 'status', 'tag'], 1]);
  return before;
}

describe('a delete is undone by one persisted record', () => {
  it('brings a deleted line back whole (texts, tags, history, run items, graph, evidence) from the app and from an accepted proposal', async () => {
    for (const surface of ['app', 'agent'] as const) {
      const ctx = setup();
      const before = await dressLineB(ctx);
      if (surface === 'app') {
        const { token } = (await ctx.send('DELETE', `/units/${ctx.unit('b').id}`)).body;
        expect(lineB(ctx)).toMatchObject({ line: undefined, ways: ['na>nc:Ask'], evidence: [{ evidence: ['a'] }] });
        expect((await ctx.send('POST', '/undo', { token })).body).toMatchObject({ ok: true });
        // A record is used once.
        expect((await ctx.send('POST', '/undo', { token })).status).toBe(400);
      } else {
        const deleted = await ctx.tool('delete_lines', { keys: ['b'], bridge: true });
        expect(lineB(ctx).line).toBeUndefined();
        // The proposal carries how to put it back: the same record, through the same gate as any undo.
        expect(ctx.db.select().from(s.proposals).where(eq(s.proposals.id, deleted.proposalId!)).get()!.undo).toEqual({ calls: [{ tool: 'restore_deleted', input: { kind: 'script', id: deleted.result!.undoId } }] });
        expect(await undoChanges(ctx.db, ctx.chat.id, [deleted.proposalId!])).toEqual([{ id: deleted.proposalId, ok: true }]);
        expect(await undoChanges(ctx.db, ctx.chat.id, [deleted.proposalId!])).toMatchObject([{ ok: false, error: '이미 되돌렸습니다' }]);
      }
      expect(lineB(ctx), surface).toEqual(before);
      expect(ctx.db.select().from(s.undoRecords).all(), surface).toEqual([]);
    }
  });

  it('an edit of the dialogue graph an agent made is taken back by its proposal\'s 되돌리기, through the same record', async () => {
    const ctx = setup();
    const { db, tool, unit, projectId, chat } = ctx;
    const ways = () => db.select().from(s.graphEdges).where(eq(s.graphEdges.projectId, projectId)).all().map((edge) => `${edge.fromId}>${edge.toId}:${edge.label ?? ''}:${edge.origin}`).sort();
    const nodes = () => db.select({ id: s.graphNodes.id }).from(s.graphNodes).where(eq(s.graphNodes.projectId, projectId)).all().map((node) => node.id).sort();
    const lines = () => db.select({ key: s.units.key }).from(s.units).where(eq(s.units.projectId, projectId)).all().map((line) => line.key).sort();
    const before = { ways: ways(), nodes: nodes(), lines: lines() };
    const undone = async (change: Awaited<ReturnType<typeof tool>>) => {
      expect(db.select().from(s.proposals).where(eq(s.proposals.id, change.proposalId!)).get()!.undo).toEqual({ calls: [{ tool: 'restore_deleted', input: { kind: 'script', id: change.result!.undoId } }] });
      expect(await undoChanges(db, chat.id, [change.proposalId!])).toEqual([{ id: change.proposalId, ok: true }]);
      expect({ ways: ways(), nodes: nodes(), lines: lines() }).toEqual(before);
    };

    // A line drawn, and one taken away.
    const linked = await tool('link_lines', { from: 'c', to: 'd', action: 'link', label: '이어서' });
    expect(ways()).toHaveLength(before.ways.length + 1);
    await undone(linked);
    const unlinked = await tool('link_lines', { from: 'b', to: 'c', action: 'unlink' });
    expect(ways()).toHaveLength(before.ways.length - 1);
    await undone(unlinked);

    // A line added after another: the new line, its node and the rewired way all go back.
    const created = await tool('create_unit', { after: 'c', key: 'c2', source: 'A new line.' });
    expect(unit('c2')).toBeDefined();
    expect(nodes()).toHaveLength(before.nodes.length + 1);
    await undone(created);

    // Nodes linked in script order.
    const ordered = await tool('link_in_order', { lines: ['c', 'd'] });
    expect(ordered.result).toMatchObject({ ok: true, linked: 1 });
    await undone(ordered);

    // Nothing changed (the line is already there): nothing to take back, and the proposal says so.
    const again = await tool('link_lines', { from: 'a', to: 'b', action: 'link' });
    expect(db.select().from(s.proposals).where(eq(s.proposals.id, again.proposalId!)).get()!.undo).toEqual({ none: '바뀐 것이 없어 되돌릴 것이 없습니다' });
    expect(db.select().from(s.undoRecords).all()).toEqual([]);
  });

  it('keeps the record across a restart of the server', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loca-undo-'));
    try {
      const file = path.join(dir, 'workbench.sqlite');
      const first = setup('bypass', openDatabase(file));
      const before = await dressLineB(first);
      const { token } = deleteLines(first.db, first.projectId, [first.unit('b').id]);
      first.db.$client.close();

      const db = openDatabase(file);
      expect(undoRecorded(db, first.projectId, token!)).toMatchObject({ ok: true });
      const unit = db.select().from(s.units).where(and(eq(s.units.projectId, first.projectId), eq(s.units.key, 'b'))).get()!;
      expect(unit).toEqual(before.line);
      expect(db.select().from(s.candidates).where(eq(s.candidates.unitId, unit.id)).all()).toEqual(before.candidates);
      db.$client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('brings a deleted scene and deleted knowledge items back with what went with them', async () => {
    const ctx = setup();
    const { db, projectId, send, tool, person } = ctx;
    const before = await dressLineB(ctx);
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    const scene = await tool('delete_group', { groupId: group.id });
    expect(scene).toMatchObject({ applied: true, result: { ok: true, deleted: 4 } });
    expect(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all()).toEqual([]);
    expect(await undoChanges(db, ctx.chat.id, [scene.proposalId!])).toEqual([{ id: scene.proposalId, ok: true }]);
    expect(lineB(ctx)).toEqual(before);
    expect(db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).all()).toEqual([group]);

    // A person with a relationship and a tag on it: the cascade's rows come back too, from the agent's delete and the app's.
    const relation = db.insert(s.relationships).values({ projectId, fromId: person('Mira').id, toId: person('Kai').id, kind: '동료' }).returning().get();
    const tag = db.select().from(s.tags).where(and(eq(s.tags.projectId, projectId), eq(s.tags.name, '긴급'))).get()!;
    db.update(s.tags).set({ scope: ['lines', 'people'] }).where(eq(s.tags.id, tag.id)).run();
    db.insert(s.knowledgeTags).values({ kind: 'relationships', itemId: relation.id, tagId: tag.id, note: '이유' }).run();
    const knowledge = () => ({
      people: db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all().sort((x, y) => x.name.localeCompare(y.name)),
      relationships: db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all(),
      tags: db.select().from(s.knowledgeTags).all(),
      terms: db.select({ source: s.terms.source }).from(s.terms).where(eq(s.terms.projectId, projectId)).all().map((term) => term.source).sort(),
    });
    const whole = knowledge();
    const gone = await tool('delete_items', { kind: 'characters', ids: [person('Mira').id] });
    expect(gone).toMatchObject({ applied: true, result: { ok: true } });
    expect(knowledge()).toMatchObject({ relationships: [], tags: [] });
    expect(await undoChanges(db, ctx.chat.id, [gone.proposalId!])).toEqual([{ id: gone.proposalId, ok: true }]);
    expect(knowledge()).toEqual(whole);
    const { token } = (await send('POST', '/knowledge-delete', { items: [{ kind: 'characters', ids: [person('Mira').id] }] })).body;
    expect(knowledge().relationships).toEqual([]);
    expect((await send('POST', '/undo', { token })).status).toBe(200);
    expect(knowledge()).toEqual(whole);
  });

  it('refuses the whole undo when the project changed so that a row cannot come back, and keeps the record', async () => {
    const { db, projectId, send, unit } = setup();
    const { token } = (await send('DELETE', `/units/${unit('b').id}`)).body;
    const group = db.select().from(s.groups).where(eq(s.groups.projectId, projectId)).get()!;
    // The key is taken by a new line.
    await send('POST', '/units', { groupId: group.id, key: 'b', source: 'Another b.' });
    const refused = await send('POST', '/undo', { token });
    expect([refused.status, refused.text]).toEqual([400, expect.stringContaining('되돌릴 수 없습니다')]);
    expect(unit('b').source).toBe('Another b.');
    expect(db.select().from(s.undoRecords).where(eq(s.undoRecords.id, token)).all()).toHaveLength(1);
  });
});

const at = { x: 0, y: 0 };
const noModel: ModelPort = { ask: async () => { throw new Error('unused'); }, generate: async () => { throw new Error('unused'); } };

describe('a line\'s status is set by one function', () => {
  it('a final status needs a translation, for a person, for the agent and for a run\'s exit action', async () => {
    const { db, projectId, send, line, tool, unit, status } = setup();
    const final = status('final');
    const initial = status('initial');
    await line('POST', `${unit('b').id}/save`, { text: '두 번째 줄.' });

    // A person, in bulk: refused whole, nothing written.
    const bulk = await send('PATCH', '/units', { unitIds: [unit('a').id, unit('b').id], statusId: final.id });
    expect([bulk.status, bulk.text]).toEqual([400, FINAL_NEEDS_TEXT]);
    expect(unit('b').statusId).not.toBe(final.id);

    // The agent: the line that may not be final is reported with the same reason, and the rest go on.
    const batch = await tool('propose_changes', { changes: [{ key: 'a', status: final.name }, { key: 'c', status: final.name, translation: '세 번째 줄.' }] });
    expect(batch).toMatchObject({ applied: true, result: { applied: 1 }, report: { dropped: [{ key: 'a', reason: FINAL_NEEDS_TEXT }] } });
    expect([unit('a').statusId, unit('c').statusId]).toEqual([initial.id, final.id]);
    // Emptying the text of a final line is the same rule from the other side.
    expect(await tool('propose_changes', { changes: [{ key: 'c', translation: '' }] })).toMatchObject({ ok: false, error: expect.stringContaining(FINAL_NEEDS_TEXT) });

    // A run: the exit's actions are a tag and the final status. The line without a translation fails there with the reason,
    // keeps its status and does not keep the tag; the translated one gets both.
    const urgent = db.insert(s.tags).values({ projectId, name: '긴급', color: '#ff0000', scope: ['lines'] }).returning().get();
    const exits: Record<string, ExitAction[]> = { true: [{ type: 'tag', action: 'add', tagIds: [urgent.id], categoryTags: {} }, { type: 'status', statusId: final.id }] };
    const definition = workflowDefinitionSchema.parse({
      nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, { id: 'gate', type: 'condition', label: '확정', position: at, config: { expression: { '==': [1, 1] } }, exits }],
      edges: [{ id: 'e', source: 'entry', sourceHandle: 'out', target: 'gate' }],
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'confirm', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { filter: { lineIds: [unit('a').id, unit('b').id] }, changeHuman: true } });
    await new Runner(db, memoryStore(), noModel).drain();
    const item = (key: string) => db.select().from(s.runItems).where(and(eq(s.runItems.runId, runId), eq(s.runItems.subjectId, unit(key).id))).get()!;
    const tagged = (key: string) => db.select().from(s.unitTags).where(eq(s.unitTags.unitId, unit(key).id)).all().length;
    expect(item('a')).toMatchObject({ state: 'failed', error: `'확정'의 출구 동작을 하지 못했습니다: ${FINAL_NEEDS_TEXT}` });
    expect([unit('a').statusId, tagged('a')]).toEqual([initial.id, 0]);
    expect(item('b')).toMatchObject({ state: 'done', error: null });
    expect([unit('b').statusId, unit('b').statusBy, unit('b').statusRunId, tagged('b')]).toEqual([final.id, 'ai', runId, 1]);
  });
});

describe('a write made from a view of a line carries its rev', () => {
  it('says the same thing to the editor, a batch and decide_suggestion when the line changed since', async () => {
    const ctx = setup('ask');
    const { db, line, tool, unit } = ctx;
    const read = unit('a').updatedAt.getTime();
    // An AI 제안 on the line, and the agent proposes to apply it: the proposal holds the line's rev as it was then.
    const candidateId = addCandidate(db, { unitId: unit('a').id, text: 'AI 번역', origin: 'ai', state: 'pending' });
    const decide = await tool('decide_suggestion', { unitId: unit('a').id, candidateId, decision: 'apply' });
    expect(db.select().from(s.proposals).where(eq(s.proposals.id, decide.proposalId!)).get()!.input).toMatchObject({ rev: unit('a').updatedAt.getTime() });

    // A person changes the line meanwhile.
    expect((await line('POST', `${unit('a').id}/save`, { text: '내 번역', rev: unit('a').updatedAt.getTime() })).status).toBe(200);

    // The editor, from the old view.
    const editor = await line('POST', `${unit('a').id}/save`, { text: '다른 번역', rev: read });
    expect([editor.status, editor.text]).toEqual([409, LINE_CHANGED]);
    // A batch, from the old view: the line is left out as a conflict, with the same words.
    expect(await tool('propose_changes', { changes: [{ key: 'a', rev: read, translation: '다른 번역' }] })).toMatchObject({ ok: false, error: expect.stringContaining(LINE_CHANGED), batch: { conflicts: [{ key: 'a', reason: LINE_CHANGED }] } });
    // The suggestion, accepted after the change: refused, the person's text stays.
    expect(await decideProposal(db, decide.proposalId!, true, 'person')).toMatchObject({ status: 'failed', result: { ok: false, error: LINE_CHANGED } });
    expect(unit('a').translation).toBe('내 번역');

    // Made from the line as it is now, the same suggestion applies.
    const again = await tool('decide_suggestion', { unitId: unit('a').id, candidateId, decision: 'apply' });
    expect(await decideProposal(db, again.proposalId!, true, 'person')).toMatchObject({ status: 'accepted' });
    expect(unit('a').translation).toBe('AI 번역');
  });

  it('a bulk change made from picks skips the lines changed since they were picked, and says how many', async () => {
    const { db, send, line, unit, projectId } = setup();
    const status = (kind: 'normal' | 'final') => db.select().from(s.statuses).where(and(eq(s.statuses.projectId, projectId), eq(s.statuses.kind, kind))).all()[0]!;
    for (const key of ['a', 'b', 'c']) await line('POST', `${unit(key).id}/save`, { text: `${key} 번역` });
    // The picks, as the bulk bar holds them: lines past the page come with their rev (the bar's own question, and a scene picked whole).
    const meta = (await send('POST', '/units/meta', { ids: ['a', 'b', 'c'].map((key) => unit(key).id) })).body.rows as { id: string; rev: number }[];
    const revs = Object.fromEntries(meta.map((row) => [row.id, row.rev]));
    expect(revs).toEqual(Object.fromEntries(['a', 'b', 'c'].map((key) => [unit(key).id, unit(key).updatedAt.getTime()])));
    const matched = (await send('POST', '/units/matches', { filter: { keys: ['a'] } })).body.rows as { id: string; rev: number }[];
    expect(matched).toMatchObject([{ id: unit('a').id, rev: revs[unit('a').id] }]);

    // Meanwhile line b changes (a run finished it, another window saved it).
    await new Promise((resolve) => setTimeout(resolve, 2));
    await line('POST', `${unit('b').id}/save`, { text: '그사이 바뀐 번역', statusId: status('normal').id });
    const before = unit('b');

    const bulk = await send('PATCH', '/units', { unitIds: Object.keys(revs), statusId: status('final').id, revs });
    expect([bulk.status, bulk.body]).toEqual([200, { ok: true, changed: 2, skipped: 1 }]);
    expect([unit('a').statusId, unit('c').statusId]).toEqual([status('final').id, status('final').id]);
    expect(unit('b')).toMatchObject({ statusId: before.statusId, translation: '그사이 바뀐 번역', updatedAt: before.updatedAt });

    // 확인함 is a decision about the line as it was seen, too: with every pick changed since, nothing is written.
    const checked = await send('PATCH', '/units', { unitIds: Object.keys(revs), checked: true, revs });
    expect(checked.body).toEqual({ ok: true, changed: 0, skipped: 3 });
    // Without revs (not made from a view of the lines) every line changes, as before.
    expect((await send('PATCH', '/units', { unitIds: Object.keys(revs), statusId: status('normal').id })).body).toEqual({ ok: true, changed: 3, skipped: 0 });
  });
});

describe('a line\'s memo and 번역 제외 are written by one service', () => {
  it('from the app\'s line pane and bulk bar, and from the agent\'s batch (which undoes them too)', async () => {
    const { db, chat, send, line, tool, unit } = setup();
    expect((await line('PATCH', unit('a').id, { note: '  확인 필요  ', translate: 'exclude' })).status).toBe(200);
    const batch = await tool('propose_changes', { changes: [{ key: 'b', memo: '  확인 필요  ', translate: 'exclude' }] });
    expect(batch).toMatchObject({ applied: true, result: { applied: 1 } });
    for (const key of ['a', 'b']) {
      expect(unit(key), key).toMatchObject({ note: '확인 필요', translate: 'exclude' });
      // The memo's history is the line's, whoever wrote it.
      expect(db.select().from(s.lineEvents).where(and(eq(s.lineEvents.unitId, unit(key).id), eq(s.lineEvents.kind, 'note'))).all(), key).toMatchObject([{ before: '', after: '확인 필요' }]);
    }
    // The same memo again is not a change.
    expect(await tool('propose_changes', { changes: [{ key: 'b', memo: '확인 필요' }] })).toMatchObject({ ok: false, empty: true });
    expect(await undoChanges(db, chat.id, [batch.proposalId!])).toMatchObject([{ ok: true }]);
    expect(unit('b')).toMatchObject({ note: '', translate: null });

    // The bulk bar hands lines back to the rules; a memo is one line's.
    expect((await send('PATCH', '/units', { unitIds: [unit('a').id, unit('b').id], translate: null })).status).toBe(200);
    expect(unit('a').translate).toBeNull();
    // `loca import` reads each line with this schema: a memo travels with it, within the memo's length.
    expect(lineChangeSchema.parse({ key: 'a', memo: '메모' })).toMatchObject({ memo: '메모' });
    expect(lineChangeSchema.safeParse({ key: 'a', memo: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('a listener named where no picked line can have one is refused; picked dialogue takes it', async () => {
    const { db, projectId, send, line, unit } = setup();
    const doc = db.insert(s.groups).values({ projectId, key: 'doc', kind: 'document', title: 'Doc', sort: 9 }).returning().get();
    const page = (await send('POST', '/units', { groupId: doc.id, key: 'page', source: 'A page.' })).body;
    const refused = await line('PATCH', page.id, { listener: 'Kai' });
    expect([refused.status, refused.text]).toEqual([400, '나레이션에는 청자가 없습니다.']);
    expect((await send('PATCH', '/units', { unitIds: [page.id, unit('a').id], listener: 'Kai' })).status).toBe(200);
    expect([unit('page').listener, unit('a').listener, unit('a').listenerOrigin]).toEqual([null, 'Kai', 'human']);
  });
});
