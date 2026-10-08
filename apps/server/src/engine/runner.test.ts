import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AI_PRESETS, importFileSchema, workflowDefinitionSchema } from '@tw/shared';
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
      const kind = request.system.includes('Review each') ? 'review' : request.system.includes('Revise each') ? 'revise' : request.system.includes('Find proper nouns') ? 'terms' : 'translate';
      if (kind === 'terms') return { object: { terms: [{ source: 'Directorate', target: '총국', note: '기관' }, { source: 'Line', target: '줄', note: '' }] }, usage: {} } as never;
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
      // Review ran three times and failed each time; the condition allows two revisions in between.
      expect(item.visits.review).toBe(3);
      expect(item.visits.revise).toBe(2);
      expect(item.data.issues).toEqual(['어색함']);
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

describe('function nodes', () => {
  it('chains AI term extraction, term candidates, a sandboxed script and an HTTP tool', async () => {
    const { createServer } = await import('node:http');
    const received: unknown[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const parsed = JSON.parse(body) as { text: string };
        received.push(parsed);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ result: { text: `${parsed.text}!` } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const { db, projectId, profileId } = setup(3);
    const tool = db.insert(s.connections).values({ kind: 'http', name: 'speller', baseUrl: `http://127.0.0.1:${port}`, headerTemplate: 'X-Key: {key}' }).returning().get();
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const confirmed = statuses.find((status) => status.kind === 'final')!;
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'terms', type: 'ai', position: { x: 0, y: 0 }, config: { profileId, output: 'terms', instructions: AI_PRESETS.terms.instructions } },
        { id: 'add', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'addTerms', params: { fromNodeId: 'terms' } } },
        {
          id: 'script',
          type: 'function',
          position: { x: 0, y: 0 },
          config: {
            fn: 'script',
            params: {
              ports: ['first', 'other'],
              code: 'export default function run(input) { return { candidate: "[" + input.unit.source + "]", port: input.unit.source === "Hi {name}" ? "first" : "other", data: { terms: input.outputs.terms.terms.length } }; }',
            },
          },
        },
        { id: 'http', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'http', params: { connectionId: tool.id, body: '{ "text": "{{candidate}}" }', resultPath: 'result.text' } } },
        { id: 'confirm', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus', params: { statusId: confirmed.id, applyCandidate: true } } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'terms' },
        { id: '2', source: 'terms', sourceHandle: 'out', target: 'add' },
        { id: '3', source: 'add', sourceHandle: 'out', target: 'script' },
        { id: '4', source: 'script', sourceHandle: 'first', target: 'http' },
        { id: '5', source: 'script', sourceHandle: 'other', target: 'confirm' },
        { id: '6', source: 'http', sourceHandle: 'out', target: 'confirm' },
        { id: '7', source: 'confirm', sourceHandle: 'out', target: 'end' },
      ],
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'functions', definition }).returning().get();
    const runner = new Runner(db, memoryStore(), fakeModel());
    const { runId } = createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, [profileId]), scope: {} });
    await runner.drain();
    server.close();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.map((item) => item.state)).toEqual(['done', 'done', 'done']);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    const byKey = new Map(units.map((unit) => [unit.key, unit]));
    // Only the first line took the "first" exit through the HTTP tool, which appended "!".
    expect(byKey.get('u0')!.translation).toBe('[Hi {name}]!');
    expect(byKey.get('u1')!.translation).toBe('[Line 1]');
    expect(received).toEqual([{ text: '[Hi {name}]' }]);
    expect(items[0].data.outputs?.script).toEqual({ terms: 2 });
    // Extracted terms are added once, as candidates, without touching confirmed context.
    const terms = db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all();
    expect(terms.map((term) => [term.source, term.status])).toEqual([
      ['Directorate', 'candidate'],
      ['Line', 'candidate'],
    ]);
    expect(db.select().from(s.candidates).where(eq(s.candidates.origin, 'tool')).all()).toHaveLength(4);
  });

  it('stops a runaway script and reports it as an error', async () => {
    const { db, projectId, profileId } = setup(1);
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'loop', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'script', params: { code: 'function run() { while (true) {} }' } } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'loop' },
        { id: '2', source: 'loop', sourceHandle: 'out', target: 'end' },
      ],
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'loop', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, profiles: snapshotProfiles(db, [profileId]), scope: {} });
    await new Runner(db, memoryStore(), fakeModel()).drain();
    const [item] = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(item.state).toBe('failed');
    expect(item.error).toContain('초 안에 끝나지 않았습니다');
  });
});
