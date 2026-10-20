import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, validateWorkflow, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1', maxAttempts: 1 }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const groups = [1, 2, 3].map((n) => ({ key: `g${n}`, title: `Scene ${n}` }));
  const units = groups.flatMap((group, scene) => [0, 1].map((n) => ({ key: `${group.key}-${n}`, group: group.key, speaker: 'MIRA', source: `S${scene} L${n}` })));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Gather' }, groups, units }), choice);
  return { db, projectId, choice };
}

const at = { x: 0, y: 0 };
const people = [{ name: 'people', type: 'list', fields: [{ name: 'name', type: 'string' }, { name: 'profile', type: 'string' }] }];
/** Each scene read on its own (one request per two lines), gathered, then combined in one request without lines. */
function flow(choice: unknown, extra: { nodes?: object[]; edges?: object[] } = {}) {
  return workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'read', type: 'ai', position: at, config: { model: choice, instructions: 'Read.', output: 'json', scope: 'batch', fields: people, batch: { mode: 'count', size: 2 } } },
      { id: 'all', type: 'gather', position: at, config: { from: 'read', fields: ['people.name'] } },
      { id: 'combine', type: 'ai', position: at, config: { model: choice, instructions: 'Combine.', output: 'json', scope: 'batch', fields: people, input: { from: 'all', lines: false } } },
      ...(extra.nodes ?? []),
    ],
    edges: [
      { id: '1', source: 'entry', sourceHandle: 'out', target: 'read' },
      { id: '2', source: 'read', sourceHandle: 'out', target: 'all' },
      { id: '3', source: 'all', sourceHandle: 'out', target: 'combine' },
      ...(extra.edges ?? []),
    ],
  });
}
const refs = (choice: { connectionId: string }) => ({ statusIds: new Set<string>(), connections: new Set([choice.connectionId]) }) as never;

describe('모으기', () => {
  it('waits for every request before it, then passes one item with all the answers to a node that reads them without lines', async () => {
    const { db, projectId, choice } = setup();
    const definition = flow(choice);
    expect(validateWorkflow(definition, refs(choice)).filter((issue) => issue.level === 'error')).toEqual([]);
    const workflow = db.insert(s.workflows).values({ projectId, name: 'g', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: { ignoreStatus: true } });
    const seen: { system: string; prompt: string }[] = [];
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push(request);
        if (request.system.includes('Combine.')) return { object: { people: [{ name: 'Mira', profile: 'all of her' }] }, usage: {} } as never;
        const scene = /S(\d)/.exec(request.prompt)![1];
        return { object: { people: [{ name: `Mira ${scene}`, profile: 'long' }] }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), port).drain();

    const combine = seen.filter((request) => request.system.includes('Combine.'));
    expect(seen.filter((request) => request.system.includes('Read.'))).toHaveLength(3);
    expect(combine).toHaveLength(1);
    const input = JSON.parse(combine[0]!.prompt) as { scenes?: unknown; previous: { parts: unknown[]; count: number; failed: number }[] };
    expect(input.scenes).toBeUndefined();
    // Trimmed to the gather's fields (no profiles), one part per scene request, in order.
    expect(input.previous).toEqual([{ parts: [{ people: [{ name: 'Mira 0' }] }, { people: [{ name: 'Mira 1' }] }, { people: [{ name: 'Mira 2' }] }], count: 3, failed: 0 }]);

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const carriers = items.filter((item) => item.data.outputs?.combine);
    expect(carriers).toHaveLength(1);
    expect(items.filter((item) => item.data.path.some((step) => step.port === 'gathered'))).toHaveLength(5);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('refuses nodes that change an item after it, an AI node that still reads lines, and a gather inside a loop', () => {
    const { choice } = setup();
    const messages = (definition: ReturnType<typeof flow>) => validateWorkflow(definition, refs(choice)).filter((issue) => issue.level === 'error').map((issue) => issue.message);
    const status = flow(choice, { nodes: [{ id: 'mark', type: 'function', position: at, config: { fn: 'setStatus', params: {} } }], edges: [{ id: '4', source: 'combine', sourceHandle: 'out', target: 'mark' }] });
    expect(messages(status)).toContainEqual(expect.stringContaining('모으기 뒤에 둘 수 없습니다'));
    const lines = flow(choice);
    const withLines = workflowDefinitionSchema.parse({ ...lines, nodes: lines.nodes.map((node) => (node.id === 'combine' && node.type === 'ai' ? { ...node, config: { ...node.config, input: { from: 'all', lines: true, fields: [] } } } : node)) });
    expect(messages(withLines)).toContainEqual(expect.stringContaining('대사를 빼고'));
    const loop = flow(choice, { edges: [{ id: '4', source: 'combine', sourceHandle: 'error', target: 'read' }] });
    expect(messages(loop)).toContainEqual(expect.stringContaining('고리 안에'));
  });
});
