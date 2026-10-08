import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotProfiles } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { createRun, Runner, type ModelPort } from './runner.ts';

function setup(lines = 30) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const profile = db
    .insert(s.profiles)
    .values({ name: 'fake', connectionId: connection.id, model: 'm', maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 })
    .returning()
    .get();
  const file = importFileSchema.parse({
    format: 'translation-workbench/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Scene' }],
    units: Array.from({ length: lines }, (_, index) => ({ key: `u${index}`, group: 'g1', source: index === 0 ? 'Hi {name}' : `Line ${index}` })),
  });
  const { projectId } = importProject(db, file, profile.id);
  const workflow = db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).get()!;
  return { db, projectId, workflow, profileId: profile.id };
}

/** Lines 1–3 fail review until revised three times; line 0 drops its placeholder once. */
function fakeModel(): ModelPort & { calls: string[] } {
  const calls: string[] = [];
  const revisions = new Map<string, number>();
  return {
    calls,
    judge: async () => {
      throw new Error('unused');
    },
    generate: async (_route, request) => {
      const input = JSON.parse(request.prompt) as { lines: { id: string; source: string; candidate?: string }[] };
      const kind = request.system.includes('Review each') ? 'review' : request.system.includes('Revise each') ? 'revise' : 'translate';
      calls.push(kind);
      if (kind === 'review') {
        return {
          object: {
            results: input.lines.map((line) => {
              const hard = /^Line [123]$/.test(line.source) && (revisions.get(line.source) ?? 0) < 4;
              return { id: line.id, passed: !hard, issues: hard ? ['어색함'] : [] };
            }),
          },
          usage: {},
        } as never;
      }
      return {
        object: {
          translations: input.lines.map((line) => {
            if (kind === 'revise') revisions.set(line.source, (revisions.get(line.source) ?? 0) + 1);
            const text = line.source === 'Hi {name}' && kind === 'translate' ? '안녕' : `[${kind}] ${line.source}`;
            return { id: line.id, text };
          }),
        },
        usage: {},
      } as never;
    },
  };
}

describe('workflow runner', () => {
  it('confirms passing lines, revises failures, then waits for a person', async () => {
    const { db, projectId, workflow, profileId } = setup();
    const model = fakeModel();
    const runner = new Runner(db, memoryStore(), model);
    const { runId, total } = createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, [profileId]), scope: {} });
    expect(total).toBe(30);
    await runner.drain();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    const statuses = new Map(db.select().from(s.statuses).all().map((status) => [status.id, status.name]));
    const units = new Map(db.select().from(s.units).all().map((unit) => [unit.id, unit]));
    const byState = Map.groupBy(items, (item) => item.state);
    expect(byState.get('waiting')?.length).toBe(3);
    expect(byState.get('done')?.length).toBe(27);

    for (const item of byState.get('waiting')!) {
      expect(item.nodeId).toBe('human');
      expect(item.visits.revise).toBe(3);
      expect(statuses.get(units.get(item.unitId)!.statusId)).toBe('사람 확인 필요');
    }
    // The placeholder slip was caught by the format check and fixed by a revision.
    const first = [...units.values()].find((unit) => unit.key === 'u0')!;
    expect(first.translation).toBe('[revise] Hi {name}');
    expect(statuses.get(first.statusId)).toBe('확정');

    // Batches are per scene (size 30), so each pass over 30 lines is one call.
    expect(model.calls.filter((call) => call === 'translate')).toHaveLength(1);

    // Approving a waiting line with an edit confirms that text.
    const waiting = byState.get('waiting')![0];
    runner.decide(waiting.id, 'approved', '사람이 고친 번역');
    await runner.drain();
    const unit = db.select().from(s.units).where(eq(s.units.id, waiting.unitId)).get()!;
    expect(unit.translation).toBe('사람이 고친 번역');
    expect(statuses.get(unit.statusId)).toBe('확정');

    for (const item of db.select().from(s.runItems).where(eq(s.runItems.state, 'waiting')).all()) runner.decide(item.id, 'rejected');
    await runner.drain();
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('marks the batch failed with the model error when no route works', async () => {
    const { db, projectId, workflow, profileId } = setup(2);
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async () => {
        throw new Error('인증 실패');
      },
    });
    const { runId } = createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, [profileId]), scope: {} });
    await runner.drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'failed' && item.error?.includes('인증 실패'))).toBe(true);
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0].ok).toBe(false);
  });
});
