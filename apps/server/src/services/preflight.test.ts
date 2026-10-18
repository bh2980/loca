import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { realistic } from '../../../../scripts/realistic-sample.ts';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { promptEntries } from '../engine/prompts.ts';
import { Runner, type ModelPort } from '../engine/runner.ts';
import { createRun } from '../engine/run-create.ts';
import { importProject } from './importer.ts';
import { preflight } from './preflight.ts';
import { snapshotWorkflowModels } from './routes.ts';
import { memoryStore } from './secrets.ts';

/** Translates everything; review passes all but every tenth line once. */
function model(): ModelPort {
  const failed = new Set<string>();
  return {
    judge: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const lines = promptEntries(request.prompt);
      if (request.system.includes('Review each'))
        return {
          object: {
            results: lines.map((line, index) => {
              const fail = index % 10 === 0 && !failed.has(line.source);
              if (fail) failed.add(line.source);
              return { id: line.id, passed: !fail, issues: fail ? ['어색함'] : [] };
            }),
          },
          usage: { inputTokens: 25_000, outputTokens: 10 },
        } as never;
      return { object: { translations: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: { inputTokens: 25_000, outputTokens: 10 } } as never;
    },
  };
}

describe('preflight', () => {
  it('predicts the plan and the calls of the run it describes', async () => {
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'mock', baseUrl: 'http://mock/v1' }).returning().get();
    db.update(s.connections).set({ maxOutputTokens: 4000, timeoutSeconds: 30, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
    const { projectId } = importProject(db, importFileSchema.parse(realistic(3000).file), choice);
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().find((row) => row.name === '초벌 번역')!;
    const scope = { ignoreStatus: true };

    // First run: no history yet, so only nodes every line passes have an expectation.
    const first = await preflight(db, workflow, scope);
    expect(first.lines.total).toBeGreaterThan(2_900);
    expect(first.plan.batches).toBeGreaterThan(10);
    // The batch list covers every planned line, and each later scene says why it joined.
    expect(first.plan.list.total).toBe(first.plan.batches);
    const listed = first.plan.list.batches;
    if (listed.length === first.plan.batches) expect(listed.reduce((sum, batch) => sum + batch.lines, 0)).toBe(first.lines.total);
    expect(listed.flatMap((batch) => batch.scenes.slice(1)).every((scene) => scene.joined !== null)).toBe(true);
    const translate = first.nodes.find((node) => node.everyLine)!;
    expect(translate.requests.min).toBe(translate.requests.max);
    expect(first.totals.calls.expected).toBe(translate.requests.expected);

    const runId = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope }).runId;
    await new Runner(db, memoryStore(), model()).drain();
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    const actual = (nodeId: string) => steps.filter((step) => step.nodeId === nodeId).length;
    // The first AI node is exact: it follows the same plan.
    expect(actual(translate.nodeId)).toBe(translate.requests.expected);

    // Second preflight learns from the run: every node has an expectation within 20% of what ran,
    // and the connection's fixed overhead is now measured.
    const second = await preflight(db, workflow, scope);
    for (const node of second.nodes) {
      expect(node.requests.expected).not.toBeNull();
      const ran = actual(node.nodeId);
      if (ran) expect(Math.abs(node.requests.expected! - ran) / ran).toBeLessThanOrEqual(0.2);
    }
    expect(second.nodes[0].overheadTokens).toBeGreaterThan(20_000);
    expect(second.totals.calls.expected).toBeGreaterThan(0);
  }, 60_000);
});
