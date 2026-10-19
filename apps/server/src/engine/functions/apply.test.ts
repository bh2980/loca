import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema, type ApplyFunctionName } from '@tw/shared';
import { openDatabase } from '../../db/index.ts';
import * as s from '../../db/schema.ts';
import { importProject } from '../../services/importer.ts';
import { decideProposal, listedProposal, proposalRuns } from '../../services/proposals.ts';
import { snapshotWorkflowModels } from '../../services/routes.ts';
import { createRun } from '../run-create.ts';
import { APPLY_TOPICS, applyFunctions, applyItems } from './apply.ts';
import { HUMAN_OWNED_NOTE, syncFunctions, type FunctionInput } from './index.ts';

const at = { x: 0, y: 0 };

function setup() {
  const db = openDatabase(':memory:');
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Harbor' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
    ],
  });
  const { projectId } = importProject(db, file);
  const definition = workflowDefinitionSchema.parse({
    nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, { id: 'apply', type: 'function', position: at, config: { fn: 'saveTerms', params: {} } }, { id: 'end', type: 'end', position: at }],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'apply' }, { id: '2', source: 'apply', sourceHandle: 'out', target: 'end' }],
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: 'wf', definition }).returning().get();
  const run = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
  const runId = (run as { id?: string }).id ?? db.select().from(s.runs).get()!.id;
  return { db, projectId, runId };
}
type Ctx = ReturnType<typeof setup>;

/** Runs an apply function on a line as the runner would: inside a transaction, with the source node's output in the item. */
function apply(ctx: Ctx, fn: ApplyFunctionName, params: Record<string, unknown>, output: Record<string, unknown> | undefined, key = 'a1') {
  const unit = ctx.db.select().from(s.units).where(eq(s.units.key, key)).get()!;
  const item = ctx.db.select().from(s.runItems).where(eq(s.runItems.unitId, unit.id)).get()!;
  const data = { ...item.data, outputs: output ? { ai: output } : ({} as Record<string, Record<string, unknown>>) };
  const input: FunctionInput = { unit, item: { ...item, nodeId: 'apply', data }, tagIds: [], projectId: ctx.projectId, runId: ctx.runId };
  return ctx.db.transaction((tx) => applyFunctions[fn](tx, { fromNodeId: 'ai', ...params }, input));
}
const proposals = (ctx: Ctx) => ctx.db.select().from(s.proposals).all();

describe('apply node mapping', () => {
  it('reads list items by the field map, drops items missing a required field and takes the first of a lines field', () => {
    const { items, skipped } = applyItems('saveSpeechRules', { fromNodeId: 'ai', list: 'rules', propose: true, asCandidate: false, map: { fromName: 'speaker', toName: 'listener', level: 'level', startKey: 'at' } }, {
      rules: [{ speaker: 'Bob', listener: 'Alice', level: 'hae', at: ['a2'] }, { speaker: 'Bob', listener: '', level: 'hae' }],
    });
    expect(items).toEqual([{ fromName: 'Bob', toName: 'Alice', level: 'hae', startKey: ['a2'] }]);
    expect(skipped).toBe(1);
  });

  it('reads nested list fields by sub-field', () => {
    const { items } = applyItems('saveRelationships', { fromNodeId: 'ai', list: 'rels', propose: true, asCandidate: false, map: { from: 'a', to: 'b', kind: 'kind', changes: 'shifts', 'changes.change': 'what' } }, {
      rels: [{ a: 'Bob', b: 'Alice', kind: '부하', shifts: [{ at: ['a2'], what: '긴장' }, { at: [], what: '무시' }] }],
    });
    expect(items[0].changes).toEqual([{ at: ['a2'], change: '긴장' }]);
  });
});

describe('apply nodes', () => {
  it('refuses a node whose source or required mapping is empty', () => {
    const ctx = setup();
    expect(() => apply(ctx, 'saveTerms', { list: 'terms', map: {} }, { terms: [] })).toThrow('연결이 비어');
    expect(() => apply(ctx, 'setListener', { map: { listener: 'value' }, fromNodeId: '' }, {})).toThrow('연결이 비어');
  });

  it('files one proposal per batch with the run id, skips non-leader lines, and accepting it saves the terms', async () => {
    const ctx = setup();
    const params = { list: 'terms', map: { source: 'source', target: 'target', kind: 'kind', meaning: 'meaning' } };
    const output = { terms: [{ source: 'boss', target: '선장님', kind: 'title', meaning: '선장 호칭' }, { source: 'mast', target: '' }], batchLeader: true };
    const first = apply(ctx, 'saveTerms', params, output);
    expect(first.output).toMatchObject({ proposed: true, items: 2 });
    const second = apply(ctx, 'saveTerms', params, { terms: [], batchLeader: false }, 'a2');
    expect(second.output).toEqual({ batchSkipped: true });
    const [proposal] = proposals(ctx);
    expect(proposals(ctx)).toHaveLength(1);
    expect(proposal).toMatchObject({ source: 'run', runId: ctx.runId, nodeId: 'apply', tool: 'save_terms', status: 'pending', sessionId: null });
    expect(proposal.input).toEqual({ terms: [{ source: 'boss', target: '선장님', note: '호칭·직함 · 선장 호칭', status: 'confirmed' }, { source: 'mast', target: '', note: '', status: 'candidate' }] });
    // Nothing is in the glossary until a person accepts.
    expect(ctx.db.select().from(s.terms).all()).toHaveLength(0);
    const done = await decideProposal(ctx.db, proposal.id, true, 'person');
    expect(done.status).toBe('accepted');
    expect(ctx.db.select().from(s.terms).all().map((t) => [t.source, t.target, t.status])).toEqual([['boss', '선장님', 'confirmed'], ['mast', '', 'candidate']]);
    const listed = listedProposal(done, proposalRuns(ctx.db, [done]).get(ctx.runId) ?? null);
    expect(listed.run).toMatchObject({ id: ctx.runId, workflow: 'wf' });
  });

  it('writes now without a proposal when propose is off, filling only what is empty', () => {
    const ctx = setup();
    ctx.db.insert(s.terms).values({ projectId: ctx.projectId, source: 'boss', target: '', status: 'candidate', origin: 'script' }).run();
    const result = apply(ctx, 'saveTerms', { propose: false, list: 'terms', map: { source: 'source', target: 'target' } }, { terms: [{ source: 'Boss', target: '선장님' }, { source: 'mast', target: '돛대' }], batchLeader: true });
    expect(result.output).toMatchObject({ applied: true, added: 1, filled: 1 });
    expect(proposals(ctx)).toHaveLength(0);
    expect(ctx.db.select().from(s.terms).all().map((t) => [t.source, t.target, t.origin])).toEqual([['boss', '선장님', 'script'], ['mast', '돛대', 'ai']]);
    // Candidates (✦) when asked.
    apply(ctx, 'saveTerms', { propose: false, asCandidate: true, list: 'terms', map: { source: 'source', target: 'target' } }, { terms: [{ source: 'sail', target: '돛' }], batchLeader: true });
    expect(ctx.db.select().from(s.terms).where(eq(s.terms.source, 'sail')).get()?.status).toBe('candidate');
  });

  it('leaves out characters already stored from a proposal and never changes a person\'s character when writing', () => {
    const ctx = setup();
    ctx.db.insert(s.characters).values({ projectId: ctx.projectId, name: 'Alice', profile: '사람이 씀', origin: 'human', statusBy: 'human' }).run();
    const params = { list: 'people', map: { name: 'name', profile: 'profile', gender: 'gender' } };
    const output = { people: [{ name: 'Alice', profile: 'AI', gender: 'female' }, { name: 'Bob', profile: '선원', gender: 'weird' }], batchLeader: true };
    const result = apply(ctx, 'saveCharacters', params, output);
    expect(result.output).toMatchObject({ proposed: true, alreadyStored: 1 });
    const [proposal] = proposals(ctx);
    expect(proposal).toMatchObject({ tool: 'save_knowledge' });
    expect(proposal.input).toEqual({ characters: [{ name: 'Bob', profile: '선원' }] });
    apply(ctx, 'saveCharacters', { ...params, propose: false }, output);
    const people = new Map(ctx.db.select().from(s.characters).all().map((c) => [c.name, c]));
    expect(people.get('Alice')).toMatchObject({ profile: '사람이 씀', gender: 'unknown', origin: 'human' });
    expect(people.get('Bob')).toMatchObject({ profile: '선원', origin: 'ai', statusBy: 'ai' });
  });

  it('proposes relationships with their changes and rules with the first start line, and events not stored yet', async () => {
    const ctx = setup();
    ctx.db.insert(s.characters).values([{ projectId: ctx.projectId, name: 'Alice' }, { projectId: ctx.projectId, name: 'Bob' }]).run();
    ctx.db.insert(s.storyEvents).values({ projectId: ctx.projectId, title: '지각' }).run();
    apply(ctx, 'saveRelationships', { list: 'r', map: { from: 'a', to: 'b', kind: 'k', changes: 'c' } }, { r: [{ a: 'Bob', b: 'Alice', k: '부하', c: [{ at: ['a2'], change: '긴장' }] }], batchLeader: true });
    apply(ctx, 'saveSpeechRules', { list: 'r', map: { fromName: 'a', toName: 'b', level: 'l', startKey: 's' } }, { r: [{ a: 'Bob', b: 'Alice', l: 'haeyo', s: ['a2'] }, { a: 'Bob', b: 'Alice', l: 'nonsense' }], batchLeader: true });
    const events = apply(ctx, 'saveEvents', { list: 'e', map: { title: 't' } }, { e: [{ t: '지각' }], batchLeader: true });
    expect(events.output).toMatchObject({ proposed: false });
    const byTool = new Map(proposals(ctx).map((p) => [Object.keys(p.input)[0], p]));
    expect(byTool.get('relationships')!.input).toEqual({ relationships: [{ from: 'Bob', to: 'Alice', kind: '부하', changes: [{ at: 'a2', change: '긴장', cause: '' }] }] });
    expect(byTool.get('speechRules')!.input).toEqual({ speechRules: [{ fromName: 'Bob', toName: 'Alice', level: 'haeyo', startKey: 'a2' }] });
    for (const proposal of proposals(ctx)) expect((await decideProposal(ctx.db, proposal.id, true, 'person')).status).toBe('accepted');
    expect(ctx.db.select().from(s.relationships).get()).toMatchObject({ kind: '부하', changes: [{ at: 'a2', change: '긴장', cause: '' }] });
    expect(ctx.db.select().from(s.speechRules).get()).toMatchObject({ fromName: 'Bob', startKey: 'a2' });
  });

  it('proposes a document as an update when the title exists, and writes only over an untouched AI document', () => {
    const ctx = setup();
    const doc = ctx.db.insert(s.documents).values({ projectId: ctx.projectId, title: '개요', kind: 'note', body: '옛', origin: 'human', statusBy: 'human' }).returning().get();
    const params = { map: { title: 't', body: 'b' } };
    apply(ctx, 'saveDocument', params, { t: '개요', b: '새', batchLeader: true });
    expect(proposals(ctx)[0]).toMatchObject({ tool: 'save_document', input: { id: doc.id, title: '개요', body: '새' } });
    const written = apply(ctx, 'saveDocument', { ...params, propose: false }, { t: '개요', b: '새', batchLeader: true });
    expect(written.output).toMatchObject({ document: 'kept' });
    expect(ctx.db.select().from(s.documents).get()?.body).toBe('옛');
  });

  it('collects a line target\'s lines into one pending proposal per node run', async () => {
    const ctx = setup();
    const params = { map: { text: 'text' } };
    apply(ctx, 'saveCandidate', params, { text: '늦었군.' }, 'a1');
    const second = apply(ctx, 'saveCandidate', params, { text: '죄송합니다.' }, 'a2');
    expect(second.candidate).toBe('죄송합니다.');
    expect(proposals(ctx)).toHaveLength(1);
    expect(proposals(ctx)[0]).toMatchObject({ source: 'run', tool: 'propose_changes', input: { origin: 'ai', changes: [{ key: 'a1', translation: '늦었군.' }, { key: 'a2', translation: '죄송합니다.' }] } });
    // Nothing reached the lines yet.
    expect(ctx.db.select().from(s.units).all().every((unit) => !unit.translation)).toBe(true);
    expect((await decideProposal(ctx.db, proposals(ctx)[0].id, true, 'person')).status).toBe('accepted');
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a2')).get()?.translation).toBe('죄송합니다.');
    // A decided proposal starts the next one.
    apply(ctx, 'saveCandidate', params, { text: '또' }, 'a1');
    expect(proposals(ctx).filter((p) => p.status === 'pending')).toHaveLength(1);
  });

  it('writes a candidate into the line unless a person saved the translation', () => {
    const ctx = setup();
    const params = { propose: false, map: { text: 'text' } };
    ctx.db.update(s.runs).set({ scope: { statusIds: [ctx.db.select().from(s.statuses).get()!.id] } }).run();
    const fresh = apply(ctx, 'saveCandidate', params, { text: '늦었군.' }, 'a1');
    expect(fresh.output).toMatchObject({ applied: true });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()).toMatchObject({ translation: '늦었군.', statusBy: 'ai' });
    expect(ctx.db.select().from(s.candidates).all()).toHaveLength(1);
    ctx.db.update(s.units).set({ translation: '사람이 씀', statusBy: 'human' }).where(eq(s.units.key, 'a2')).run();
    const owned = apply(ctx, 'saveCandidate', params, { text: '죄송' }, 'a2');
    expect(owned.output).toMatchObject({ applied: false });
    expect(owned.issues).toEqual([HUMAN_OWNED_NOTE]);
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a2')).get()?.translation).toBe('사람이 씀');
    expect(ctx.db.select().from(s.candidates).all()).toHaveLength(2);
    // 후보(✦)로 넣기 leaves the translation column alone.
    const only = apply(ctx, 'saveCandidate', { ...params, asCandidate: true }, { text: '또' }, 'a1');
    expect(only.output).toMatchObject({ applied: false, asCandidate: true });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()?.translation).toBe('늦었군.');
  });

  it('sets a listener as an AI guess, never over a person\'s, and proposes through set_listeners', async () => {
    const ctx = setup();
    const params = { map: { listener: 'value', confidence: 'confidence' } };
    apply(ctx, 'setListener', params, { value: 'Bob', confidence: 0.8 }, 'a1');
    expect(proposals(ctx)[0]).toMatchObject({ tool: 'set_listeners', input: { lines: [{ key: 'a1', listener: 'Bob', confidence: 0.8 }] } });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()?.listener).toBeNull();
    await decideProposal(ctx.db, proposals(ctx)[0].id, true, 'person');
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()).toMatchObject({ listener: 'Bob', listenerOrigin: 'ai', listenerConfidence: 0.8 });
    ctx.db.update(s.units).set({ listener: 'Guard', listenerOrigin: 'human' }).where(eq(s.units.key, 'a2')).run();
    const kept = apply(ctx, 'setListener', { ...params, propose: false }, { value: 'Alice', confidence: 1 }, 'a2');
    expect(kept.output).toMatchObject({ recorded: false });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a2')).get()?.listener).toBe('Guard');
    // A choice with no answer (value null) applies nothing.
    expect(apply(ctx, 'setListener', params, { value: null, confidence: 0 }, 'a1').output).toMatchObject({ applied: false });
    // "unknown" is the AI saying it cannot tell: nothing is proposed, the line stays 청자 미상.
    const before = proposals(ctx).length;
    expect(apply(ctx, 'setListener', params, { value: 'unknown', confidence: 0.95 }, 'a1').output).toMatchObject({ recorded: false, reason: '청자 미상' });
    expect(proposals(ctx)).toHaveLength(before);
  });

  it('tags lines by name and never creates a tag', async () => {
    const ctx = setup();
    const tag = ctx.db.insert(s.tags).values({ projectId: ctx.projectId, name: '긴급', color: 'x' }).returning().get();
    const params = { map: { tag: 'value' } };
    apply(ctx, 'tagLines', { ...params, propose: false }, { value: '긴급' }, 'a1');
    expect(ctx.db.select().from(s.unitTags).all().map((row) => row.tagId)).toEqual([tag.id]);
    expect(apply(ctx, 'tagLines', { ...params, propose: false }, { value: '없는 태그' }, 'a2').output).toMatchObject({ tagged: false });
    apply(ctx, 'tagLines', params, { value: '긴급' }, 'a2');
    expect(proposals(ctx)[0]).toMatchObject({ tool: 'propose_changes', input: { changes: [{ key: 'a2', addTags: ['긴급'] }] } });
    expect((await decideProposal(ctx.db, proposals(ctx)[0].id, true, 'person')).status).toBe('accepted');
    expect(ctx.db.select().from(s.unitTags).all()).toHaveLength(2);
  });

  it('proposes scene listeners with their exceptions and writes them as scene guesses', async () => {
    const ctx = setup();
    const params = { list: 'scenes', map: { scene: 'scene', speaker: 'speaker', listener: 'to', confidence: 'conf', exceptions: 'except' } };
    const output = { scenes: [{ scene: 'g1', speaker: 'Alice', to: 'Bob', conf: 0.95, except: [{ line: ['a1'], listener: 'Crowd' }] }], batchLeader: true };
    apply(ctx, 'saveSceneListeners', params, output);
    expect(proposals(ctx)[0]).toMatchObject({ tool: 'set_listeners', input: { scenes: [{ scene: 'g1', speaker: 'Alice', listener: 'Bob', confidence: 0.95, exceptions: [{ line: 'a1', listener: 'Crowd' }] }] } });
    const written = apply(ctx, 'saveSceneListeners', { ...params, propose: false }, output);
    expect(written.output).toMatchObject({ changed: 1 });
    expect(ctx.db.select().from(s.units).where(eq(s.units.key, 'a1')).get()).toMatchObject({ listener: 'Crowd', listenerOrigin: 'ai' });
  });

  it('is registered as instant functions and names the topics it writes', () => {
    expect(Object.keys(syncFunctions)).toEqual(expect.arrayContaining(Object.keys(APPLY_TOPICS)));
    expect(APPLY_TOPICS.saveTerms).toEqual(['proposals', 'terms']);
    expect(APPLY_TOPICS.saveEvents).toContain('knowledge');
  });
});
