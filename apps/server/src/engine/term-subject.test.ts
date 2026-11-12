import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiNodeConfigSchema, contextFor, importFileSchema, runScopeInputSchema, SUBJECTS, validateWorkflow, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/model-target.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';
import { selectRunTerms, subjectOf } from './subjects.ts';
import { buildRequest } from './request.ts';
import { askedScope, scopeMismatch } from '../services/run-plan.ts';

/** A project whose script mentions Varn Gate (twice) and Hesk (once), with both as candidate terms without a Korean form, and one confirmed term. */
function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Terms' },
    groups: [{ key: 'g1', title: 'Gate' }],
    units: [
      { key: 'a1', group: 'g1', speaker: 'MIRA', source: 'Meet me at Varn Gate.', translation: '바른 게이트에서 봐.' },
      { key: 'a2', group: 'g1', speaker: 'KAI', source: 'Varn Gate is closed.' },
      { key: 'a3', group: 'g1', speaker: 'MIRA', source: 'Hesk is far.' },
    ],
  });
  const { projectId } = importProject(db, file, choice);
  db.delete(s.terms).where(eq(s.terms.projectId, projectId)).run();
  const term = (source: string, extra: Partial<typeof s.terms.$inferInsert> = {}) =>
    db.insert(s.terms).values({ projectId, source, status: 'candidate', origin: 'script', statusBy: 'ai', examples: [], ...extra }).returning().get();
  const gate = term('Varn Gate', { examples: ['a1', 'a2'] });
  const hesk = term('Hesk', { examples: ['a3'] });
  term('Kai', { target: '카이', status: 'confirmed', statusBy: 'human' });
  return { db, projectId, choice, gate, hesk };
}

const at = { x: 0, y: 0 };
/** 용어 번역 as a workflow (input terms): one AI answer per term, then 용어 표기 저장. */
function termWorkflow(choice: unknown) {
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: { input: 'terms' } },
      {
        id: 'translate',
        type: 'ai',
        position: at,
        config: {
          model: choice,
          instructions: 'Decide each term.',
          output: 'json',
          scope: 'line',
          fields: [{ name: 'target', type: 'string' }, { name: 'note', type: 'string' }],
          batch: { mode: 'count', size: 10 },
        },
      },
      { id: 'save', type: 'function', position: at, config: { fn: 'saveCandidate', params: { map: { text: 'target', note: 'note' } } } },
    ],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' }, { id: '2', source: 'translate', sourceHandle: 'out', target: 'save' }],
  });
}

describe('a workflow whose input is terms', () => {
  it('takes the terms its scope names (statuses, an empty Korean form or ids), most used first', () => {
    const { db, projectId, gate, hesk } = setup();
    const candidatesWithoutForm: s.RunScope = { terms: { statuses: ['candidate'], emptyTarget: true } };
    expect(selectRunTerms(db, projectId, candidatesWithoutForm)).toEqual([gate.id, hesk.id]);
    expect(selectRunTerms(db, projectId, {})).toHaveLength(3);
    expect(selectRunTerms(db, projectId, { terms: { ids: [hesk.id] } })).toEqual([hesk.id]);
    // A scope that can hold no term holds none: it is never read as every term.
    expect(selectRunTerms(db, projectId, { terms: { nothing: true } })).toEqual([]);
  });

  it('filters terms like the glossary: status, the remaining marks, and term tags that must all be on', () => {
    const { db, projectId, gate, hesk } = setup();
    expect(selectRunTerms(db, projectId, { terms: { statuses: ['candidate'], emptyTarget: true } })).toEqual([gate.id, hesk.id]);
    const kai = db.select().from(s.terms).where(eq(s.terms.source, 'Kai')).get()!;
    db.update(s.terms).set({ statusBy: 'ai' }).where(eq(s.terms.id, kai.id)).run();
    expect(selectRunTerms(db, projectId, { terms: { decidedBy: 'ai' } })).toEqual([kai.id]);
    const place = db.insert(s.tags).values({ projectId, name: '지명', color: '#000000', scope: ['terms'] }).returning().get();
    db.insert(s.knowledgeTags).values({ kind: 'terms', itemId: gate.id, tagId: place.id }).run();
    expect(selectRunTerms(db, projectId, { terms: { tagIds: [place.id] } })).toEqual([gate.id]);
    // A scope of the other input is refused before anything is counted or run; a mark the input does not have is not a scope at all.
    expect(scopeMismatch('lines', { terms: { emptyTarget: true } })).toContain('용어 범위');
    expect(scopeMismatch('terms', { filter: { unfinished: true } })).toContain('대사 필터');
    expect(scopeMismatch('terms', { terms: { marks: ['unused'], decidedBy: 'ai', emptyTarget: true } })).toBeNull();
    expect(runScopeInputSchema.safeParse({ filter: { marks: ['unused'] } }).success).toBe(false);
    expect(runScopeInputSchema.safeParse({ terms: { marks: ['diverged'] } }).success).toBe(false);
    // Names resolve as everywhere: a status by its label, a term by its source, and what is not there by name.
    expect(askedScope(db, projectId, 'terms', { terms: { statuses: ['후보'], terms: ['Varn Gate'], tags: ['지명'] } })).toEqual({ ok: true, scope: { terms: { ids: [gate.id], statuses: ['candidate'], tagIds: [place.id] } } });
    expect(askedScope(db, projectId, 'terms', { terms: { statuses: ['없는상태'], terms: ['Nowhere'], tags: ['없는태그'] } })).toEqual({ ok: false, error: '찾지 못함: 용어 Nowhere, 상태 없는상태, 태그 없는태그' });
  });

  it('sends the confirmed terms found in the term itself, even with no example lines, but not the term as its own context', () => {
    const { db, projectId, gate } = setup();
    db.insert(s.terms).values({ projectId, source: 'Varn', target: '바른', status: 'confirmed', statusBy: 'human', origin: 'human', examples: [] }).run();
    const node = { id: 'translate', type: 'ai', position: at, config: aiNodeConfigSchema.parse({ model: { connectionId: 'c', model: 'm' }, instructions: '', output: 'json', scope: 'line', fields: [{ name: 'target', type: 'string' }], context: { glossary: true, examples: 0 } }) } as never;
    const { context } = buildRequest(db, projectId, node, 'terms', [{ id: gate.id }]);
    expect(context.terms.map((term) => term.source)).toEqual(['Varn']);
    const varn = db.select().from(s.terms).where(eq(s.terms.source, 'Varn')).get()!;
    expect(buildRequest(db, projectId, node, 'terms', [{ id: varn.id }]).context.terms).toEqual([]);
  });

  it('builds a term request without the context only lines have, whatever the node kept from before', () => {
    const { db, projectId, choice, gate } = setup();
    // A node switched from a lines workflow still carries its line settings; talking pairs used to stay on for terms.
    db.update(s.units).set({ listener: 'KAI', listenerOrigin: 'human' }).where(eq(s.units.projectId, projectId)).run();
    const node = workflowDefinitionSchema.parse({
      nodes: [{ id: 'ai', type: 'ai', position: at, config: { model: choice, output: 'json', fields: [{ name: 'target', type: 'string' }], context: { pairs: true, pairMinTurns: 1, speech: true, precedingLines: 8, previousScenes: 2, examples: 2 } } }],
      edges: [],
    }).nodes[0]!;
    if (node.type !== 'ai') throw new Error('not an AI node');
    const kinds = new Set(buildRequest(db, projectId, node, 'terms', [{ id: gate.id }]).context.items.map((item) => item.kind));
    for (const kind of ['pair', 'speech', 'preceding', 'previousScene'] as const) expect(kinds.has(kind), kind).toBe(false);
    // The same settings on a lines request do send talking pairs: it is the input that turns them off.
    const line = db.select().from(s.units).where(eq(s.units.key, 'a1')).get()!;
    expect(contextFor('lines', node.config.context).pairs).toBe(true);
    expect(contextFor('terms', node.config.context)).toMatchObject({ pairs: false, speech: false, precedingLines: 0, previousScenes: 0, examples: 2 });
    expect(contextFor('lines', node.config.context)).toMatchObject({ examples: 0, precedingLines: 8 });
    expect(buildRequest(db, projectId, node, 'lines', [{ id: line.id }]).lines).toHaveLength(1);
  });

  it('answers everything a run asks about its items through the subject adapter, for every subject', () => {
    const { db, projectId, gate, hesk } = setup();
    expect(SUBJECTS.map((subject) => subjectOf(subject).subject)).toEqual([...SUBJECTS]);
    // The same questions, each subject's own answers.
    expect(subjectOf('terms').select(db, projectId, { terms: { ids: [hesk.id] } })).toEqual([hesk.id]);
    expect(subjectOf('lines').select(db, projectId, {})).toHaveLength(3);
    expect(subjectOf('terms').scopeOf([gate.id])).toEqual({ terms: { ids: [gate.id] } });
    expect(subjectOf('terms').scopeOf([])).toEqual({ terms: { nothing: true } });
    expect(subjectOf('lines').scopeOf(['u1'])).toMatchObject({ filter: { lineIds: ['u1'] } });
    expect(subjectOf('lines').scopeOf([])).toMatchObject({ filter: { nothing: true } });
    expect([subjectOf('lines').topic, subjectOf('terms').topic]).toEqual(['units', 'terms']);
    expect([subjectOf('lines').tagScope, subjectOf('terms').tagScope]).toEqual(['lines', 'terms']);
  });

  it('sends each term with its example lines, saves the Korean form of each candidate and confirms it', async () => {
    const { db, projectId, choice, gate, hesk } = setup();
    const definition = termWorkflow(choice);
    expect(validateWorkflow(definition, { statusIds: new Set(), connections: new Set([choice.connectionId]) } as never).filter((issue) => issue.level === 'error')).toEqual([]);
    const workflow = db.insert(s.workflows).values({ projectId, name: '용어 번역', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: { terms: { statuses: ['candidate'], emptyTarget: true } } });
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.subject).toBe('terms');
    const seen: { system: string; prompt: string }[] = [];
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_target, request) => {
        seen.push(request);
        const items = promptEntries(request.prompt) as { id: string; source: string }[];
        return { object: { results: items.map((item) => (item.source === 'Varn Gate' ? { id: item.id, target: '바른 게이트', note: '지명' } : { id: item.id, target: '헤스크', note: '' })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toContain('"term" is a glossary entry');
    const items = promptEntries(seen[0]!.prompt) as { id: string; kind: string; source: string; uses?: number; examples?: { source: string; translation?: string }[] }[];
    expect(items.map((item) => [item.id, item.kind, item.source])).toEqual([['T1', 'term', 'Varn Gate'], ['T2', 'term', 'Hesk']]);
    expect(items[0]!.examples).toEqual([{ speaker: 'MIRA', source: 'Meet me at Varn Gate.', translation: '바른 게이트에서 봐.' }, { speaker: 'KAI', source: 'Varn Gate is closed.' }]);

    expect(db.select().from(s.terms).where(eq(s.terms.id, gate.id)).get()).toMatchObject({ target: '바른 게이트', note: '지명', status: 'confirmed', statusBy: 'ai' });
    expect(db.select().from(s.terms).where(eq(s.terms.id, hesk.id)).get()).toMatchObject({ target: '헤스크', status: 'confirmed', statusBy: 'ai' });
    expect(db.select().from(s.terms).where(eq(s.terms.status, 'rejected')).all()).toHaveLength(0);
    expect(db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all().every((item) => item.state === 'done')).toBe(true);
  });

  it('keeps the term a candidate when the project\'s AI 문맥 switch is off, and files no proposal', async () => {
    const { db, projectId, choice, gate, hesk } = setup();
    db.update(s.projects).set({ aiAutoConfirm: false }).run();
    const definition = termWorkflow(choice);
    const workflow = db.insert(s.workflows).values({ projectId, name: '용어 번역', definition }).returning().get();
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: { terms: { statuses: ['candidate'], emptyTarget: true } } });
    const port: ModelPort = {
      ask: async () => {
        throw new Error('unused');
      },
      generate: async (_target, request) => ({ object: { results: (promptEntries(request.prompt) as { id: string }[]).map((item) => ({ id: item.id, target: '바른 게이트', note: '' })) }, usage: {} }) as never,
    };
    await new Runner(db, memoryStore(), port).drain();
    expect(db.select().from(s.terms).where(eq(s.terms.id, gate.id)).get()).toMatchObject({ target: '바른 게이트', status: 'candidate' });
    expect(db.select().from(s.terms).where(eq(s.terms.id, hesk.id)).get()).toMatchObject({ target: '바른 게이트', status: 'candidate' });
    expect(db.select().from(s.proposals).all()).toHaveLength(0);
  });

  it('shows a node of the other input or a batch mode terms do not have as a validation error', () => {
    const { choice } = setup();
    const definition = termWorkflow(choice);
    const bad = workflowDefinitionSchema.parse({
      ...definition,
      nodes: definition.nodes.map((node) => (node.id === 'translate' && node.type === 'ai' ? { ...node, config: { ...node.config, batch: { ...node.config.batch, mode: 'group' } } } : node.id === 'save' ? { ...node, config: { fn: 'setListener', params: { map: { listener: 'target' } } } } : node)),
    });
    const messages = validateWorkflow(bad, { statusIds: new Set(), connections: new Set([choice.connectionId]) } as never).filter((issue) => issue.level === 'error').map((issue) => issue.message);
    expect(messages).toContainEqual(expect.stringContaining('용어 입력에서는 묶음을'));
    expect(messages).toContainEqual(expect.stringContaining('용어 입력 워크플로에 쓸 수 없는 노드'));
  });
});
