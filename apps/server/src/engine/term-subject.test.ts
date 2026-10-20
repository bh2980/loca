import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, validateWorkflow, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun, selectRunTerms } from './run-create.ts';

/** A project whose script mentions Varn Gate (twice) and Hesk (once), with both as candidate terms without a Korean form, and one confirmed term. */
function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1', maxAttempts: 1 }).returning().get();
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
/** 용어 번역 as a workflow: terms in, one AI answer per term, 용어 표기 저장 for terms, 용어 상태 변경 (rejected) for the rest. */
function termWorkflow(choice: unknown, propose = false) {
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: { subject: 'terms' } },
      {
        id: 'translate',
        type: 'ai',
        position: at,
        config: {
          model: choice,
          instructions: 'Decide each term.',
          output: 'json',
          scope: 'line',
          fields: [{ name: 'isTerm', type: 'boolean' }, { name: 'target', type: 'string' }, { name: 'note', type: 'string' }],
          batch: { mode: 'count', size: 10 },
        },
      },
      { id: 'is-term', type: 'condition', position: at, config: { expression: { '==': [{ var: 'outputs.translate.isTerm' }, true] } } },
      { id: 'save', type: 'function', position: at, config: { fn: 'saveTermEntry', params: { map: { target: 'target', note: 'note' }, propose } } },
      { id: 'reject', type: 'function', position: at, config: { fn: 'setTermStatus', params: { status: 'rejected', propose } } },
    ],
    edges: [
      { id: '1', source: 'entry', sourceHandle: 'out', target: 'translate' },
      { id: '2', source: 'translate', sourceHandle: 'out', target: 'is-term' },
      { id: '3', source: 'is-term', sourceHandle: 'true', target: 'save' },
      { id: '4', source: 'is-term', sourceHandle: 'false', target: 'reject' },
    ],
  });
}

describe('a workflow whose items are terms', () => {
  it('starts with the candidates without a Korean form, most used first', () => {
    const { db, projectId, choice, gate, hesk } = setup();
    expect(selectRunTerms(db, projectId, termWorkflow(choice), {})).toEqual([gate.id, hesk.id]);
    expect(selectRunTerms(db, projectId, termWorkflow(choice), { termIds: [hesk.id] })).toEqual([hesk.id]);
  });

  it('sends each term with its example lines, saves the Korean form of terms and rejects the rest', async () => {
    const { db, projectId, choice, gate, hesk } = setup();
    const definition = termWorkflow(choice);
    expect(validateWorkflow(definition, { statusIds: new Set(), connections: new Set([choice.connectionId]) } as never).filter((issue) => issue.level === 'error')).toEqual([]);
    const workflow = db.insert(s.workflows).values({ projectId, name: '용어 번역', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.subject).toBe('terms');
    const seen: { system: string; prompt: string }[] = [];
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push(request);
        const items = promptEntries(request.prompt) as { id: string; source: string }[];
        return { object: { results: items.map((item) => (item.source === 'Varn Gate' ? { id: item.id, isTerm: true, target: '바른 게이트', note: '지명' } : { id: item.id, isTerm: false, target: '', note: '' })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.system).toContain('"term" is a glossary entry');
    const items = promptEntries(seen[0]!.prompt) as { id: string; kind: string; source: string; uses?: number; examples?: { source: string; translation?: string }[] }[];
    expect(items.map((item) => [item.id, item.kind, item.source])).toEqual([['T1', 'term', 'Varn Gate'], ['T2', 'term', 'Hesk']]);
    expect(items[0]!.examples).toEqual([{ speaker: 'MIRA', source: 'Meet me at Varn Gate.', translation: '바른 게이트에서 봐.' }, { speaker: 'KAI', source: 'Varn Gate is closed.' }]);

    expect(db.select().from(s.terms).where(eq(s.terms.id, gate.id)).get()).toMatchObject({ target: '바른 게이트', note: '지명', status: 'candidate', statusBy: 'ai' });
    expect(db.select().from(s.terms).where(eq(s.terms.id, hesk.id)).get()).toMatchObject({ target: '', status: 'rejected', statusBy: 'ai' });
    expect(db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all().every((item) => item.state === 'done')).toBe(true);
  });

  it('proposes by default: the run collects its terms into proposals instead of writing', async () => {
    const { db, projectId, choice, gate } = setup();
    const definition = termWorkflow(choice, true);
    const workflow = db.insert(s.workflows).values({ projectId, name: '용어 번역', definition }).returning().get();
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} });
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => ({ object: { results: (promptEntries(request.prompt) as { id: string; source: string }[]).map((item) => ({ id: item.id, isTerm: item.source === 'Varn Gate', target: '바른 게이트', note: '' })) }, usage: {} }) as never,
    };
    await new Runner(db, memoryStore(), port).drain();
    expect(db.select().from(s.terms).where(eq(s.terms.id, gate.id)).get()!.target).toBe('');
    const proposals = db.select().from(s.proposals).all();
    expect(proposals.map((proposal) => proposal.tool)).toEqual(['save_terms', 'save_terms']);
    expect(proposals.flatMap((proposal) => (proposal.input as { terms: unknown[] }).terms)).toEqual(expect.arrayContaining([expect.objectContaining({ id: gate.id, target: '바른 게이트' }), expect.objectContaining({ status: 'rejected' })]));
  });

  it('refuses line-only nodes and scene batches in a term workflow', () => {
    const { choice } = setup();
    const definition = termWorkflow(choice);
    const bad = workflowDefinitionSchema.parse({
      ...definition,
      nodes: definition.nodes.map((node) => (node.id === 'translate' && node.type === 'ai' ? { ...node, config: { ...node.config, batch: { ...node.config.batch, mode: 'group' } } } : node.id === 'reject' ? { ...node, config: { fn: 'setStatus', params: {} } } : node)),
    });
    const messages = validateWorkflow(bad, { statusIds: new Set(), connections: new Set([choice.connectionId]) } as never).filter((issue) => issue.level === 'error').map((issue) => issue.message);
    expect(messages).toContainEqual(expect.stringContaining('개수별·하나씩'));
    expect(messages).toContainEqual(expect.stringContaining('용어 워크플로에서 쓸 수 없습니다'));
  });
});
