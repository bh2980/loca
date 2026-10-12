import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotProfiles } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { createRun, Runner, type ModelPort } from './runner.ts';

/** A project of `scenes` scenes; scene i has `size(i)` lines. Scene keys sort opposite to script order. */
function setup(scenes: number, size: (scene: number) => number) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const profile = db
    .insert(s.profiles)
    .values({ name: 'fake', connectionId: connection.id, model: 'm', maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 })
    .returning()
    .get();
  const groups = Array.from({ length: scenes }, (_, index) => ({ key: `g${String(scenes - index).padStart(6, '0')}`, title: `Scene ${index}` }));
  const units = groups.flatMap((group, scene) => Array.from({ length: size(scene) }, (_, index) => ({ key: `${group.key}-${index}`, group: group.key, source: `S${scene} L${index}` })));
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'Test' }, groups, units }), profile.id);
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).get()!;
  const start = (limits?: s.RunLimits) =>
    createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, [profile.id]), scope: { ignoreStatus: true }, limits }).runId;
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
      return { object: { translations: input.lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage } as never;
    },
  };
}

const runOf = (db: ReturnType<typeof setup>['db'], runId: string) => db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!;

describe('runner at scale', () => {
  it('finishes a run over more lines than SQLite binds in one statement', async () => {
    const { db, workflow } = setup(34, () => 1_000);
    // Large batches keep the test fast; the point is the 40,000 queued items.
    const definition = { ...workflow.definition, nodes: workflow.definition.nodes.map((node) => (node.type === 'ai' ? { ...node, config: { ...node.config, batch: { mode: 'count' as const, size: 200, maxTokens: 6_000 } } } : node)) };
    db.update(s.workflows).set({ definition }).where(eq(s.workflows.id, workflow.id)).run();
    const runId = createRun(db, { projectId: workflow.projectId, workflow: { ...workflow, definition }, profiles: snapshotProfiles(db, Object.values(definition.nodes).flatMap((node) => (node.type === 'ai' ? [node.config.profileId] : []))), scope: { ignoreStatus: true } }).runId;
    const runner = new Runner(db, memoryStore(), model());
    await runner.drain(5_000);
    expect(runOf(db, runId).status).toBe('completed');
    const states = db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(states.length).toBe(34_000);
    expect(states.every((item) => item.state === 'done')).toBe(true);
  }, 60_000);

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
  it('asks again only for the lines an answer left out, then moves every line on', async () => {
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
        return { object: { translations: kept.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), fake).drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    const rerequest = steps.find((step) => step.round === 1)!;
    expect(rerequest.unitIds).toHaveLength(3);
    expect(steps.find((step) => step.round === 0 && step.returnedLines === 7)).toBeTruthy();
  });

  it('splits a malformed answer for many lines into halves instead of failing them all', async () => {
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
        return { object: { translations: input.lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: {} } as never;
      },
    };
    await new Runner(db, memoryStore(), fake).drain();
    const items = db.select({ state: s.runItems.state }).from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    // 8 lines → 4+4 → 2+2: only the 2-line part that holds L5 fails.
    expect(items.filter((item) => item.state === 'failed')).toHaveLength(2);
    expect(items.filter((item) => item.state === 'done')).toHaveLength(6);
  });
});

