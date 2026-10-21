import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, termExtractionTemplate, workflowDefinitionSchema, type WorkflowDefinition } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { preflight } from '../services/preflight.ts';
import { calledWorkflowErrors, workflowIssues } from '../services/workflow-issues.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';
import { translateOnlyWorkflow } from './test-workflows.ts';

const CUT_OFF = () => new ai.ModelError('cli', 'Your previous response was cut off because it exceeded the output token limit', false);
const at = { x: 0, y: 0 };

/**
 * A project of eight lines with "번역 → 호출(용어 추출)": the project's 번역 cut down to translate and save,
 * then a call node naming a saved 용어 추출 workflow (its terms node batching `termsBatch` lines).
 */
function setup({ termsBatch = 8, callError }: { termsBatch?: number; callError?: 'handled' } = {}) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = Array.from({ length: 8 }, (_, index) => ({ key: `u${index}`, group: 'g1', source: `Hello ${index}` }));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups: [{ key: 'g1', title: 'Scene' }], units }), choice);
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const review = db.insert(s.statuses).values({ projectId, name: '사람 확인 필요', color: '#b26f00', kind: 'normal', inReview: true, sort: 10 }).returning().get();

  const extraction = termExtractionTemplate({ model: choice });
  const called = db.insert(s.workflows).values({
    projectId,
    name: '용어 추출',
    description: '',
    // Its own settings (a visit limit of 1) must not apply to the calling run.
    definition: workflowDefinitionSchema.parse({
      ...extraction,
      nodes: extraction.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, concurrency: 1, batch: { ...node.config.batch, mode: 'count', size: termsBatch } } } : node)),
      settings: { maxVisitsPerNode: 1, maxConsecutiveFailures: 1 },
    }),
  }).returning().get();

  const base = translateOnlyWorkflow(db, projectId).definition;
  const outer = workflowDefinitionSchema.parse({
    ...base,
    settings: { ...base.settings, maxConsecutiveFailures: 50 },
    nodes: [
      ...base.nodes,
      { id: 'call', type: 'call', position: at, config: { workflowId: called.id } },
      ...(callError ? [
        { id: 'is-other', type: 'condition', position: at, config: { expression: { '==': [{ var: 'error.kind' }, 'other'] } } },
        { id: 'to-review', type: 'function', position: at, config: { fn: 'setStatus', params: { statusId: review.id } } },
      ] : []),
    ],
    edges: [
      ...base.edges,
      { id: 'save-call', source: 'save', sourceHandle: 'out', target: 'call' },
      ...(callError ? [{ id: 'call-error', source: 'call', sourceHandle: 'error', target: 'is-other' }, { id: 'other-review', source: 'is-other', sourceHandle: 'true', target: 'to-review' }] : []),
    ],
  });
  const workflow = db.insert(s.workflows).values({ projectId, name: '번역 후 용어 추출', description: '', definition: outer }).returning().get();
  return { db, projectId, choice, workflow, called, review, initial: statuses.find((status) => status.kind === 'initial')! };
}

/** Translates every request; a terms request (its system says "Find proper nouns") is answered by `terms`, which may throw. Records the size of each terms request. */
function model(terms: (size: number, n: number) => Error | null = () => null) {
  const termRequests: number[] = [];
  const port: ModelPort = {
    judge: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const lines = promptEntries(request.prompt) as { id: string; source: string }[];
      if (request.system.includes('Find proper nouns')) {
        termRequests.push(lines.length);
        const error = terms(lines.length, termRequests.length);
        if (error) throw error;
        return { object: { terms: [{ source: 'Hello', target: '안녕', kind: 'other', meaning: '인사', evidence: [] }] }, usage: {} } as never;
      }
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
    },
  };
  return { port, termRequests };
}

const start = (fixture: ReturnType<typeof setup>) => createRun(fixture.db, { projectId: fixture.projectId, workflow: fixture.workflow, models: {}, scope: {} });
const itemsOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;

describe('워크플로 호출 in a run', () => {
  it('번역 → 호출(용어 추출) runs both: lines translated and done, terms saved; the run stores the expanded definition', async () => {
    const fixture = setup();
    const { runId } = start(fixture);
    const fake = model();
    await new Runner(fixture.db, memoryStore(), fake.port).drain();

    const run = runOf(fixture.db, runId);
    expect(run.status).toBe('completed');
    expect(itemsOf(fixture.db, runId).every((item) => item.state === 'done')).toBe(true);
    expect(fixture.db.select().from(s.units).all().every((unit) => unit.translation?.startsWith('[ko] '))).toBe(true);
    expect(fixture.db.select().from(s.terms).where(eq(s.terms.projectId, fixture.projectId)).all().map((term) => [term.source, term.target])).toEqual([['Hello', '안녕']]);
    expect(fake.termRequests).toEqual([8]);

    // No call node in the run: its nodes are the called workflow's, prefixed, and the call is named.
    expect(run.definition.nodes.some((node) => node.type === 'call')).toBe(false);
    expect(run.definition.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['call/terms', 'call/save-terms', 'call/terms-resend']));
    expect(run.definition.calls).toEqual({ call: { name: '용어 추출', workflowId: fixture.called.id } });
    expect(run.definition.settings.maxVisitsPerNode).toBe(fixture.workflow.definition.settings.maxVisitsPerNode);
    const steps = fixture.db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps.filter((step) => step.nodeId === 'call/terms')).toHaveLength(1);
    // The called workflow's model is frozen with the run too.
    expect(Object.keys(run.models)).toHaveLength(1);
    // The saved workflow is untouched.
    expect(fixture.workflow.definition.nodes.some((node) => node.type === 'call')).toBe(true);
  });

  it('lines leave through 오류 with their error kind and message when the called workflow\'s AI keeps failing', async () => {
    const fixture = setup({ callError: 'handled' });
    const { runId } = start(fixture);
    const fake = model(() => new Error('boom'));
    await new Runner(fixture.db, memoryStore(), fake.port).drain();

    // Handled by the 오류 branch: it can read the original kind, so only an 'other' failure reaches 검토 필요.
    const items = itemsOf(fixture.db, runId);
    expect(items).toHaveLength(8);
    expect(items.every((item) => item.state === 'done')).toBe(true);
    expect(items.every((item) => item.data.path.some((step) => step.nodeId === 'call/terms' && step.port === 'error'))).toBe(true);
    expect(items.every((item) => item.data.path.some((step) => step.nodeId === 'is-other' && step.port === 'true'))).toBe(true);
    expect(fixture.db.select().from(s.units).all().every((unit) => unit.statusId === fixture.review.id)).toBe(true);
  });

  it('ends the lines failed with the original failure when 오류 is not connected', async () => {
    const fixture = setup();
    const { runId } = start(fixture);
    const fake = model(() => new Error('boom'));
    await new Runner(fixture.db, memoryStore(), fake.port).drain();
    for (const item of itemsOf(fixture.db, runId)) {
      expect(item.state).toBe('failed');
      expect(item.data.error).toMatchObject({ kind: 'other', message: 'boom', nodeId: 'call/terms' });
      expect(item.error).toContain('boom');
    }
    // The translation itself was done before the call.
    expect(fixture.db.select().from(s.units).all().every((unit) => unit.translation?.startsWith('[ko] '))).toBe(true);
  });

  it('a 재요청 inside the called workflow sends a cut-off request again, smaller, and succeeds', async () => {
    const fixture = setup();
    const { runId } = start(fixture);
    const fake = model((_size, n) => (n === 1 ? CUT_OFF() : null));
    await new Runner(fixture.db, memoryStore(), fake.port).drain();
    expect(fake.termRequests).toEqual([8, 4, 4]);
    expect(runOf(fixture.db, runId).status).toBe('completed');
    const items = itemsOf(fixture.db, runId);
    expect(items.every((item) => item.state === 'done' && !item.data.error)).toBe(true);
    expect(items.every((item) => item.data.retry?.times['call/terms-resend'] === 1)).toBe(true);
    expect(fixture.db.select().from(s.terms).where(eq(s.terms.projectId, fixture.projectId)).all()).toHaveLength(1);
  });

  it('refuses to start when a call cannot be expanded, with the validation message', () => {
    const fixture = setup();
    const missing = { ...fixture.workflow, definition: workflowDefinitionSchema.parse({ ...fixture.workflow.definition, nodes: fixture.workflow.definition.nodes.map((node) => (node.type === 'call' ? { ...node, config: { workflowId: 'gone' } } : node)) }) };
    expect(() => createRun(fixture.db, { projectId: fixture.projectId, workflow: missing, models: {}, scope: {} })).toThrow('부르는 워크플로가 없습니다.');
    // The called workflow calls the calling one back: expanding it would lead to the calling workflow again.
    const back = { ...fixture.called.definition, nodes: [...fixture.called.definition.nodes, { id: 'back', type: 'call' as const, position: at, config: { workflowId: fixture.workflow.id } }] };
    fixture.db.update(s.workflows).set({ definition: back }).where(eq(s.workflows.id, fixture.called.id)).run();
    expect(() => start(fixture)).toThrow("'번역 후 용어 추출'을(를) 부르면 다시 이 워크플로로 돌아옵니다.");
  });
});

describe('워크플로 호출 in preflight and validation', () => {
  it('preflight lists the called workflow\'s AI nodes with the caller\'s', async () => {
    const fixture = setup();
    const result = await preflight(fixture.db, fixture.workflow, {});
    expect(result.nodes.map((node) => node.nodeId)).toEqual(['translate', 'call/terms']);
    expect(result.nodes[1]!.requests.max).toBeGreaterThan(0);
    // A call that cannot be expanded is refused like a run start.
    const broken = { ...fixture.workflow, definition: { ...fixture.workflow.definition, nodes: fixture.workflow.definition.nodes.map((node) => (node.type === 'call' ? { ...node, config: { workflowId: '' } } : node)) } as WorkflowDefinition };
    await expect(preflight(fixture.db, broken, {})).rejects.toThrow('부를 워크플로를 고르세요.');
  });

  it('reads the project\'s workflows for call issues and finds problems inside the called workflow', () => {
    const fixture = setup();
    expect(workflowIssues(fixture.db, fixture.projectId, fixture.workflow.definition, fixture.workflow.id).filter((issue) => issue.nodeId === 'call')).toEqual([]);
    // The called workflow's AI node lost its model: reported at run start with the call's name.
    const broken = { ...fixture.called.definition, nodes: fixture.called.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, model: { connectionId: '', model: '' } } } : node)) };
    fixture.db.update(s.workflows).set({ definition: broken }).where(eq(s.workflows.id, fixture.called.id)).run();
    expect(calledWorkflowErrors(fixture.db, fixture.projectId, fixture.workflow.definition, fixture.workflow.id)).toEqual([expect.stringContaining('용어 추출 › AI 용어 추출: AI 연결과 모델을 고르세요.')]);
    // A cycle shows on the call node.
    const cyclic = { ...fixture.called.definition, nodes: [...fixture.called.definition.nodes, { id: 'back', type: 'call' as const, position: at, config: { workflowId: fixture.workflow.id } }] };
    fixture.db.update(s.workflows).set({ definition: cyclic }).where(eq(s.workflows.id, fixture.called.id)).run();
    expect(workflowIssues(fixture.db, fixture.projectId, fixture.workflow.definition, fixture.workflow.id).filter((issue) => issue.nodeId === 'call').map((issue) => issue.message)).toEqual(["'용어 추출'을(를) 부르면 다시 이 워크플로로 돌아옵니다."]);
  });
});
