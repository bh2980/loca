import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ModelError } from '@tw/ai';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { INPUT_SCRIPT } from './format-sentences.ts';
import { Runner, sceneHalf, type ModelPort } from './runner.ts';
import { createRun, createRunInSteps } from './run-create.ts';

/** Two scenes, three lines, a labelled branch: the whole-script tests' script. */
function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1', maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [
      { key: 'g1', title: 'Harbor', section: 'Ch 1' },
      { key: 'g2', title: 'Deck', section: 'Ch 1' },
    ],
    units: [
      { key: 'a1', group: 'g1', speaker: 'Alice', source: "You're late." },
      { key: 'a2', group: 'g1', speaker: 'Bob', source: 'Sorry, boss.' },
      { key: 'b1', group: 'g2', speaker: 'Alice', source: 'Never again.' },
    ],
  });
  const { projectId } = importProject(db, file, choice);
  return { db, projectId, choice };
}

const at = { x: 0, y: 0 };
const wholeFlow = (choice: unknown, config: Record<string, unknown>) =>
  workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: {} },
      { id: 'read', type: 'ai', position: at, config: { model: choice, instructions: 'Read the script.', batch: { mode: 'whole', size: 1, maxTokens: 300_000 }, ...config } },
      { id: 'end', type: 'end', position: at },
    ],
    edges: [
      { id: '1', source: 'entry', sourceHandle: 'out', target: 'read' },
      { id: '2', source: 'read', sourceHandle: 'out', target: 'end' },
    ],
  });
const peopleNode = { output: 'json', scope: 'batch', fields: [{ name: 'people', type: 'list', fields: [{ name: 'name', type: 'string' }, { name: 'evidence', type: 'lines' }] }] };
const answer = { people: [{ name: 'Alice', evidence: ['L1', 'L3', 'L99'] }, { name: 'Bob', evidence: ['L2'] }] };

type Request = Parameters<ModelPort['generate']>[1];
const port = (reply: (request: Request) => unknown): ModelPort => ({
  judge: async () => {
    throw new Error('unused');
  },
  generate: async (_route, request) => ({ object: reply(request), usage: { inputTokens: 10, outputTokens: 5 } }) as never,
});

function run(db: ReturnType<typeof setup>['db'], projectId: string, definition: ReturnType<typeof wholeFlow>, scope = {}) {
  const workflow = db.insert(s.workflows).values({ projectId, name: 'whole', definition }).returning().get();
  return createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope });
}

describe('a node reading the script whole', () => {
  it('sends compact script text with only a neutral description of the input, and stores one answer with line keys', async () => {
    const { db, projectId, choice } = setup();
    const requests: Request[] = [];
    const runner = new Runner(db, memoryStore(), port((request) => (requests.push(request), answer)));
    const { runId } = run(db, projectId, wholeFlow(choice, peopleNode));
    await runner.drain();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.prompt).toBe('SCRIPT:\n## Ch 1 — Harbor [g1]\n  L1 Alice: You\'re late.\n  L2 Bob: Sorry, boss.\n\n## Ch 1 — Deck [g2]\n  L3 Alice: Never again.');
    // The node's instructions plus the neutral format sentences; no hidden purpose rules.
    expect(request.system).toContain('Read the script.');
    expect(request.system).toContain(INPUT_SCRIPT);
    expect(request.system).toContain('Answer as one JSON object');
    expect(request.system).not.toMatch(/prior knowledge|KNOWN CHARACTERS|under about 15,000/);
    expect(request.timeoutMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(db.select({ kind: s.aiCalls.kind }).from(s.aiCalls).where(eq(s.aiCalls.refId, runId)).all().map((call) => call.kind)).toEqual(['whole']);

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    const units = new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit]));
    const outputs = items.sort((a, b) => units.get(a.unitId)!.seq - units.get(b.unitId)!.seq).map((item) => item.data.outputs!.read);
    expect(outputs).toEqual([
      { people: [{ name: 'Alice', evidence: ['a1', 'b1'] }, { name: 'Bob', evidence: ['a2'] }], batchLeader: true },
      { batchLeader: false },
      { batchLeader: false },
    ]);
    expect(items.every((item) => item.state === 'done')).toBe(true);
  });

  it('puts the node\'s context (cast, glossary) before the script', async () => {
    const { db, projectId, choice } = setup();
    db.insert(s.characters).values([{ projectId, name: 'Alice', aliases: ['Al'] }, { projectId, name: 'Draft', status: 'candidate' }]).run();
    const requests: Request[] = [];
    const runner = new Runner(db, memoryStore(), port((request) => (requests.push(request), answer)));
    run(db, projectId, wholeFlow(choice, { ...peopleNode, context: { cast: true } }));
    await runner.drain();

    const [context, script] = requests[0].prompt.split('\n\nSCRIPT:\n');
    expect(JSON.parse(context.replace(/^CONTEXT:\n/, ''))).toEqual({ cast: [{ name: 'Alice', aliases: ['Al'] }] });
    expect(script.startsWith('## Ch 1 — Harbor [g1]')).toBe(true);
    expect(requests[0].system).toContain('The "context" before the script');
  });

  it('answers per line by the script\'s own line ids when the output is not batch scope', async () => {
    const { db, projectId, choice } = setup();
    const runner = new Runner(db, memoryStore(), port(() => ({ results: [{ id: 'L1', text: 'one' }, { id: 'L2', text: 'two' }, { id: 'L3', text: 'three' }] })));
    const { runId } = run(db, projectId, wholeFlow(choice, { output: 'text' }));
    await runner.drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.map((item) => item.data.candidateText).sort()).toEqual(['one', 'three', 'two']);
  });

  it('reads a request the model refuses as too long again in halves, cut between scenes', async () => {
    const { db, projectId, choice } = setup();
    const prompts: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      ...port(() => answer),
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('too-long', 'prompt is too long', false);
        return { object: { people: [{ name: 'Alice', evidence: ['L1'] }] }, usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    const { runId } = run(db, projectId, wholeFlow(choice, peopleNode));
    await runner.drain();
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('[g1]');
    expect(prompts[1]).not.toContain('[g2]');
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
    // Each half has its own leader.
    const leaders = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all().filter((item) => (item.data.outputs?.read as { batchLeader: boolean }).batchLeader);
    expect(leaders).toHaveLength(2);
  });

  it('splits an answer cut off at the output limit like one that is too long', async () => {
    const { db, projectId, choice } = setup();
    const prompts: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      ...port(() => answer),
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('cli', 'CLI가 실패를 반환했습니다: Your previous response was cut off because it exceeded the output token limit', false);
        return { object: { people: [] }, usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    const { runId } = run(db, projectId, wholeFlow(choice, peopleNode));
    await runner.drain();
    expect(prompts).toHaveLength(3);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('refuses a second whole-script run while one is active', async () => {
    const { db, projectId, choice } = setup();
    const definition = wholeFlow(choice, peopleNode);
    const workflow = db.insert(s.workflows).values({ projectId, name: 'whole', definition }).returning().get();
    const input = { projectId, workflow, models: snapshotWorkflowModels(db, definition), scope: {} };
    await createRunInSteps(db, input);
    await expect(createRunInSteps(db, input)).rejects.toThrow('이미 진행 중');
  });

  it('cuts between scenes near the middle', () => {
    expect(sceneHalf(['a', 'a', 'b', 'c', 'c', 'c'])).toBe(3);
    expect(sceneHalf(['a', 'a', 'a', 'a', 'b'])).toBe(4);
    expect(sceneHalf(['a', 'a', 'a'])).toBe(2);
  });
});
