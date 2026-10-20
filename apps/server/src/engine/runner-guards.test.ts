import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema, translationTemplate } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { errorKindOf, Runner, type ModelPort } from './runner.ts';
import { createRun, createRunInSteps } from './run-create.ts';

/** A project of `scenes` scenes; scene i has `size(i)` lines. Scene keys sort opposite to script order. */
function setup(scenes: number, size: (scene: number) => number) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const groups = Array.from({ length: scenes }, (_, index) => ({ key: `g${String(scenes - index).padStart(6, '0')}`, title: `Scene ${index}` }));
  const units = groups.flatMap((group, scene) => Array.from({ length: size(scene) }, (_, index) => ({ key: `${group.key}-${index}`, group: group.key, source: `S${scene} L${index}` })));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups, units }), choice);
  const needsReview = db.insert(s.statuses).values({
    projectId,
    name: '사람 확인 필요',
    color: '#b26f00',
    kind: 'normal',
    inReview: true,
    sort: 10,
  }).returning().get();
  const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
  const untranslated = statuses.find((s) => s.kind === 'initial')!;
  const draft = statuses.find((s) => s.kind === 'normal' && s.id !== needsReview.id)!;
  const confirmed = statuses.find((s) => s.kind === 'final')!;
  const workflow = db.insert(s.workflows).values({
    projectId,
    name: '검수 포함 번역',
    description: '',
    definition: translationTemplate({
      model: choice,
      untranslated: untranslated.id,
      draft: draft.id,
      needsReview: needsReview.id,
      confirmed: confirmed.id,
    }),
  }).returning().get();
  const start = (limits?: s.RunLimits) =>
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { ignoreStatus: true }, limits }).runId;
  return { db, workflow, start };
}

/** Translates and passes everything; `fail` decides which calls throw. Records each call's lines. */
function model(fail: (call: number) => Error | null = () => null): ModelPort & { firsts: string[]; calls: string[][] } {
  const firsts: string[] = [];
  const calls: string[][] = [];
  return {
    firsts,
    calls,
    judge: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const input = { lines: promptEntries(request.prompt) as { id: string; source: string }[] };
      firsts.push(input.lines[0].source);
      calls.push(input.lines.map((line) => line.source));
      const error = fail(firsts.length);
      if (error) throw error;
      const usage = { inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, reasoningTokens: 5, costUsd: 0.01 };
      if (request.system.includes('Review each')) return { object: { results: input.lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage } as never;
      return { object: { results: input.lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage } as never;
    },
  };
}

const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;

describe('runner at scale', () => {
  it('finishes a run over more lines than SQLite binds in one statement', async () => {
    const { db, workflow } = setup(34, () => 1_000);
    // Large batches keep the test fast; the point is exceeding SQLite's bind limit, not wall time.
    // Windows can take over a minute for the 34,000 lines; assert every item finishes below.
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count' as const, size: 200, maxTokens: 6_000 } } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    const runId = createRun(db, { projectId: workflow.projectId, workflow: { ...workflow, definition }, models: snapshotWorkflowModels(db, definition), scope: { ignoreStatus: true } }).runId;
    const runner = new Runner(db, memoryStore(), model());
    await runner.drain(5_000);
    expect(runOf(db, runId).status).toBe('completed');
    const states = db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(states.length).toBe(34_000);
    expect(states.every((item) => item.state === 'done')).toBe(true);
  }, 120_000);

  it('sends scenes in script order, not by internal id, and packs short scenes together', async () => {
    const { db, start } = setup(12, () => 2);
    start();
    const fake = model();
    await new Runner(db, memoryStore(), fake).drain();
    const scenes = (sources: string[]) => sources.map((source) => Number(source.slice(1, source.indexOf(' '))));
    // 24 lines in 2-line scenes fit one 30-line request, in script order.
    expect(scenes(fake.calls[0])).toEqual([...Array(12).keys()].flatMap((scene) => [scene, scene]));
  });
});

describe('runner guards', () => {
  it('pauses at the first failure retrying cannot fix, with the reason', async () => {
    const { db, start } = setup(20, () => 3);
    const runId = start();
    const fake = model(() => new ai.ModelError('auth', '인증에 실패했습니다.', false));
    await new Runner(db, memoryStore(), fake).drain();
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toContain('인증 오류');
    // Only the calls already in flight when the first one failed (concurrency 2).
    expect(fake.firsts.length).toBeLessThanOrEqual(2);
  });

  it('pauses after the configured number of failures in a row', async () => {
    const { db, start } = setup(200, () => 3);
    const runId = start();
    const fake = model(() => new ai.ModelError('invalid-output', '응답 형식이 맞지 않습니다.', false));
    await new Runner(db, memoryStore(), fake).drain();
    const run = runOf(db, runId);
    expect(run.status).toBe('paused');
    expect(run.notice).toContain('3번 연달아');
    expect(fake.firsts.length).toBeLessThanOrEqual(4);
  });

  it('pauses at the call cap and resumes on request, clearing the notice', async () => {
    const { db, start } = setup(200, () => 3);
    const runId = start({ maxCalls: 4 });
    const runner = new Runner(db, memoryStore(), model());
    await runner.drain();
    expect(runOf(db, runId).status).toBe('paused');
    expect(runOf(db, runId).notice).toContain('호출 상한');
    runner.resume(runId);
    expect(runOf(db, runId)).toMatchObject({ status: 'running', notice: null });
  });

  it('checks the input cap before each call, counting calls in flight, so a run stops short of it', async () => {
    const tiny = setup(20, () => 3);
    const none = tiny.start({ maxInputTokens: 1 });
    const idle = model();
    await new Runner(tiny.db, memoryStore(), idle).drain();
    expect(idle.calls).toHaveLength(0);
    expect(runOf(tiny.db, none)).toMatchObject({ status: 'paused', notice: expect.stringContaining('넘지 않도록') });

    const { db, start } = setup(200, () => 3);
    const cap = 5_000;
    const runId = start({ maxInputTokens: cap });
    await new Runner(db, memoryStore(), model()).drain();
    const used = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all().reduce((total, step) => total + (step.inputTokens ?? 0), 0);
    expect(runOf(db, runId).status).toBe('paused');
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(cap);
  });

  it('records every usage field of a call, failed attempts included', async () => {
    const { db, start } = setup(1, () => 2);
    const runId = start();
    await new Runner(db, memoryStore(), model()).drain();
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step).toMatchObject({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 20, reasoningTokens: 5, costUsd: 0.01 });

    const failing = setup(1, () => 2);
    const failedRun = failing.start();
    const usage = { inputTokens: 50, outputTokens: 7 };
    await new Runner(failing.db, memoryStore(), model(() => new ai.ModelError('invalid-output', 'bad', false, usage))).drain();
    const failed = failing.db.select().from(s.runSteps).where(eq(s.runSteps.runId, failedRun)).get()!;
    expect(failed).toMatchObject({ ok: false, inputTokens: 50, outputTokens: 7 });
  });

  it('pauses only the run whose tick throws; the others keep going', async () => {
    const { db, start } = setup(2, () => 2);
    const broken = start();
    const healthy = start();
    // A definition the runner cannot read stands in for any error inside one run's tick.
    db.update(s.runs).set({ definition: {} as never }).where(eq(s.runs.id, broken)).run();
    await new Runner(db, memoryStore(), model()).drain();
    expect(runOf(db, broken)).toMatchObject({ status: 'paused' });
    expect(runOf(db, broken).notice).toContain('실행기 오류');
    expect(runOf(db, healthy).status).toBe('completed');
  });
});

describe('incomplete answers', () => {
  it('names a failure by what went wrong', () => {
    expect(errorKindOf(new ai.ModelError('invalid-output', 'bad JSON', false))).toBe('invalid-output');
    expect(errorKindOf(new ai.ModelError('cli', 'Your previous response was cut off because it exceeded the output token limit', false))).toBe('cut-off');
    expect(errorKindOf(new ai.ModelError('cli', '모델이 응답을 거절했습니다.', false))).toBe('refused');
    expect(errorKindOf(new Error('boom'))).toBe('other');
  });

  it('sends lines an answer left out through "error" (missing); the template asks again for just those', async () => {
    const { db, start } = setup(1, () => 10);
    const runId = start();
    let call = 0;
    const fake: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        call++;
        const input = { lines: promptEntries(request.prompt) as { id: string; source: string }[] };
        const review = request.system.includes('Review each');
        // The first translate request drops its last three lines.
        const kept = !review && call === 1 ? input.lines.slice(0, -3) : input.lines;
        if (review) return { object: { results: kept.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
        return { object: { results: kept.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), fake).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const translations = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all().filter((step) => step.nodeId === 'translate');
    // 10 lines, 7 answered; the 3 left out came back through 다시 시도? on their own.
    expect(translations.map((step) => [step.unitIds.length, step.returnedLines])).toEqual([[10, 7], [3, 3]]);
  });

  it('never splits a malformed answer: its lines leave through "error" (invalid-output), the template retries once, then ends them as failed', async () => {
    const { db, start } = setup(1, () => 8);
    const runId = start();
    const fake: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        const input = { lines: promptEntries(request.prompt) as { id: string; source: string }[] };
        // Any request that contains line 5 comes back malformed.
        if (input.lines.some((line) => line.source.endsWith('L5'))) throw new ai.ModelError('invalid-output', 'bad JSON', false, { inputTokens: 10 });
        const review = request.system.includes('Review each');
        if (review) return { object: { results: input.lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
        return { object: { results: input.lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), fake).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'failed' && item.error === 'bad JSON')).toBe(true);
    expect(items[0]!.data.error).toMatchObject({ kind: 'invalid-output', nodeId: 'translate' });
    const translations = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all().filter((step) => step.nodeId === 'translate');
    expect(translations.map((step) => step.unitIds.length)).toEqual([8, 8]);
    expect(runOf(db, runId).status).toBe('completed');
  });

  it('ends the lines of a request longer than the model window as failed (too-long) with what to do, without pausing the run', async () => {
    const { db, start } = setup(1, () => 8);
    const runId = start();
    const fake: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        const lines = promptEntries(request.prompt) as { id: string; source: string }[];
        if (lines.length > 4) throw new ai.ModelError('too-long', 'maximum context length exceeded', false);
        if (request.system.includes('Review each')) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
        return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), fake).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(runOf(db, runId).status).toBe('completed');
    expect(items.every((item) => item.state === 'failed' && item.data.error?.kind === 'too-long')).toBe(true);
    expect(items[0]!.error).toContain('더 작은 묶음');
    expect(db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all()).toHaveLength(1);
  });
});

describe('run plan', () => {
  it('keeps each plan batch whole through every node', async () => {
    const { db, start } = setup(30, (scene) => 3 + (scene % 5) * 7);
    const runId = start();
    const kinds: { review: boolean; sources: string[] }[] = [];
    const fake = model();
    const generate = fake.generate;
    fake.generate = async (route, request) => {
      kinds.push({ review: request.system.includes('Review each'), sources: promptEntries(request.prompt).map((line) => line.source) });
      return generate(route, request);
    };
    await new Runner(db, memoryStore(), fake).drain();
    const planOf = new Map(
      db
        .select({ source: s.units.source, plan: s.runItems.plan })
        .from(s.runItems)
        .innerJoin(s.units, eq(s.units.id, s.runItems.unitId))
        .where(eq(s.runItems.runId, runId))
        .all()
        .map((row) => [row.source, row.plan]),
    );
    const members = Map.groupBy([...planOf], ([, plan]) => plan);
    expect(members.size).toBeGreaterThan(1);
    for (const call of kinds) {
      // Every plan batch a request touches is in it whole (nothing failed, so nothing was split off).
      for (const plan of new Set(call.sources.map((source) => planOf.get(source) ?? null)))
        expect(members.get(plan)!.every(([source]) => call.sources.includes(source))).toBe(true);
    }
    expect(kinds.some((call) => call.review)).toBe(true);
  });
});

describe('slots per account', () => {
  /** Counts calls in flight per connection and remembers the peak; each call takes `ms(kind)`. */
  function timedModel(ms: (review: boolean) => number) {
    const now = new Map<string, number>();
    const peak = new Map<string, number>();
    const order: string[] = [];
    const port: ModelPort = {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (route, request) => {
        const review = request.system.includes('Review each');
        const account = (route as { baseUrl?: string }).baseUrl ?? '';
        now.set(account, (now.get(account) ?? 0) + 1);
        peak.set(account, Math.max(peak.get(account) ?? 0, now.get(account)!));
        order.push(review ? 'R' : 'T');
        await new Promise((resolve) => setTimeout(resolve, ms(review)));
        now.set(account, now.get(account)! - 1);
        const lines = promptEntries(request.prompt);
        if (review) return { object: { results: lines.map((line) => ({ id: line.id, passed: true, issues: [] })) }, usage: {} } as never;
        return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    return { port, peak, order };
  }

  it('two runs on one account never exceed its slots together', async () => {
    const { db, start } = setup(40, () => 20);
    db.update(s.connections).set({ concurrency: 3 }).run();
    start();
    start();
    const { port, peak } = timedModel(() => 5);
    await new Runner(db, memoryStore(), port).drain();
    expect(Math.max(...peak.values())).toBe(3);
  });

  it('a slow account does not hold up nodes on another account', async () => {
    const { db, workflow, start } = setup(40, () => 20);
    // Review on a second, slow account with one slot; translate keeps its own two.
    const slow = db.insert(s.connections).values({ kind: 'openai', name: 'slow', baseUrl: 'http://slow/v1', concurrency: 1 }).returning().get();
    db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, slow.id)).run();
    const reviewer = { connectionId: slow.id, model: 'm' };
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' && node.config.instructions.includes('Review each') ? { ...node, config: { ...node.config, model: reviewer } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    void start;
    createRun(db, { projectId: workflow.projectId, workflow: { ...workflow, definition }, models: snapshotWorkflowModels(db, definition), scope: { ignoreStatus: true } });
    const { port, peak, order } = timedModel((review) => (review ? 40 : 5));
    await new Runner(db, memoryStore(), port).drain();
    expect(peak.get('http://slow/v1')).toBe(1);
    // Every translate request went out before the slow reviews were done.
    expect(order.lastIndexOf('T')).toBeLessThan(order.lastIndexOf('R'));
    expect(order.indexOf('R')).toBeLessThan(order.lastIndexOf('T'));
  });
});

describe('sharing and branching', () => {
  it('spreads a node over the accounts of its models', async () => {
    const { db, workflow } = setup(12, () => 5);
    const other = db.insert(s.connections).values({ kind: 'openai', name: 'second', baseUrl: 'http://localhost:2/v1', concurrency: 1 }).returning().get();
    db.update(s.connections).set({ outputTokens: 1000, maxAttempts: 1 }).where(eq(s.connections.id, other.id)).run();
    const second = { connectionId: other.id, model: 'm2' };
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, extraModels: [second], batch: { mode: 'count' as const, size: 5, maxTokens: 6_000 } } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    const fresh = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    const runId = createRun(db, { projectId: fresh.projectId, workflow: fresh, models: snapshotWorkflowModels(db, fresh.definition), scope: { ignoreStatus: true } }).runId;
    const models: string[] = [];
    const base = model();
    // Calls take a moment, so both accounts are busy at once.
    const slow: ModelPort = { ...base, generate: async (route, request) => (models.push(route.model), await new Promise((resolve) => setTimeout(resolve, 5)), base.generate(route, request)) };
    await new Runner(db, memoryStore(), slow).drain();
    expect(runOf(db, runId).status).toBe('completed');
    expect(new Set(models)).toEqual(new Set(['m', 'm2']));
    // Each call records the connection it went out through.
    const steps = db.select({ model: s.runSteps.model, connectionId: s.runSteps.connectionId }).from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps.filter((step) => step.model === 'm2').every((step) => step.connectionId === other.id)).toBe(true);
    expect(steps.some((step) => step.connectionId === other.id)).toBe(true);
  });

  it('sends a line down every branch of an exit and counts it done once all of them are', async () => {
    const { db, workflow } = setup(2, () => 3);
    const end = { id: 'side-end', type: 'end' as const, position: { x: 0, y: 0 }, config: {} };
    const entry = workflow.definition.nodes.find((node) => node.type === 'entry')!;
    const firstEdge = workflow.definition.edges.find((edge) => edge.source === entry.id)!;
    const definition = { ...workflow.definition, nodes: [...workflow.definition.nodes, end], edges: [...workflow.definition.edges, { id: 'side', source: entry.id, sourceHandle: firstEdge.sourceHandle, target: 'side-end' }] };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    const fresh = db.select().from(s.workflows).where(eq(s.workflows.id, workflow.id)).get()!;
    const runId = createRun(db, { projectId: fresh.projectId, workflow: fresh, models: snapshotWorkflowModels(db, fresh.definition), scope: { ignoreStatus: true } }).runId;
    await new Runner(db, memoryStore(), model()).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    // Six lines, each with an item on the main path and a copy that went straight to the side end.
    expect(items).toHaveLength(12);
    expect(items.filter((item) => item.nodeId === 'side-end' && item.state === 'done')).toHaveLength(6);
    expect(runOf(db, runId).status).toBe('completed');
  });
});

describe('creating a large run', () => {
  it('stores the lines in steps, waits paused meanwhile, and starts once all are in', async () => {
    const { db, workflow } = setup(5, () => 1_000);
    const pending = createRunInSteps(db, { projectId: workflow.projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { ignoreStatus: true } });
    // Before the first step yields, the run exists paused and cannot be resumed early.
    const early = db.select().from(s.runs).all()[0];
    expect(early).toMatchObject({ status: 'paused', notice: expect.stringContaining('넣는 중') });
    new Runner(db, memoryStore(), model()).resume(early.id);
    expect(runOf(db, early.id).status).toBe('paused');
    const { runId, total } = await pending;
    expect(total).toBe(5_000);
    expect(db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all()).toHaveLength(5_000);
    expect(runOf(db, runId)).toMatchObject({ status: 'running', notice: null });
  });
});
