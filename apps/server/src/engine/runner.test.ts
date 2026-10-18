import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { AI_PRESETS, importFileSchema, knowledgeTemplate, listenerTemplate, translationTemplate, workflowDefinitionSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { promptEntries } from './prompts.ts';
import { Runner, type ModelPort } from './runner.ts';
import { createRun } from './run-create.ts';

function setup(lines = 30) {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Test' },
    groups: [{ key: 'g1', title: 'Scene' }],
    units: Array.from({ length: lines }, (_, index) => ({ key: `u${index}`, group: 'g1', source: index === 0 ? 'Hi {name}' : `Line ${index}` })),
  });
  const { projectId } = importProject(db, file, choice);
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
  return { db, projectId, workflow, choice };
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
      const input = { lines: promptEntries(request.prompt) as { id: string; source: string; candidate?: string }[] };
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
  it('confirms passing lines, revises failures, then hands the rest to the review status', async () => {
    const { db, projectId, workflow, choice } = setup();
    const model = fakeModel();
    const runner = new Runner(db, memoryStore(), model);
    const { runId, total } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    expect(total).toBe(30);
    await runner.drain();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    const statuses = new Map(db.select().from(s.statuses).all().map((status) => [status.id, status.name]));
    const units = new Map(db.select().from(s.units).all().map((unit) => [unit.id, unit]));
    const byState = Map.groupBy(items, (item) => item.state);
    expect(byState.get('done')?.length).toBe(30);
    const escalated = items.filter((item) => item.nodeId === 'escalate');
    expect(escalated).toHaveLength(3);

    for (const item of escalated) {
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

    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('leaves a line that fails review with its last revision text and the review status', async () => {
    const { db, projectId, workflow } = setup();
    const runner = new Runner(db, memoryStore(), fakeModel());
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await runner.drain();

    const units = new Map(db.select().from(s.units).all().map((unit) => [unit.id, unit]));
    const statuses = new Map(db.select().from(s.statuses).all().map((status) => [status.id, status.name]));
    const escalated = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all().filter((item) => item.nodeId === 'escalate');
    expect(escalated).toHaveLength(3);
    for (const item of escalated) {
      const line = units.get(item.unitId)!;
      // Every revision wrote to the line, so the last one is the current translation; the escalate
      // node then set the review status while the text stayed put.
      expect(line.translation).toBe(`[revise] ${line.source}`);
      expect(statuses.get(line.statusId)).toBe('사람 확인 필요');
    }
  });

  it('marks the batch failed with the model error when no route works', async () => {
    const { db, projectId, workflow, choice } = setup(2);
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async () => {
        throw new Error('인증 실패');
      },
    });
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await runner.drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'failed' && item.error?.includes('인증 실패'))).toBe(true);
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0].ok).toBe(false);
  });
});

describe('listener estimation', () => {
  it('records AI listeners with their confidence and leaves a person\'s choice alone', async () => {
    const { db, projectId, choice } = setup(3);
    db.update(s.units).set({ speaker: 'Ann' }).where(eq(s.units.projectId, projectId)).run();
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.sort).all();
    db.update(s.units).set({ listener: 'Bob', listenerOrigin: 'human' }).where(eq(s.units.id, units[2].id)).run();
    db.insert(s.characters).values([{ projectId, name: 'Alice' }, { projectId, name: 'Pat', player: true }]).run();
    const workflow = db.insert(s.workflows).values({ projectId, name: '청자', definition: listenerTemplate({ model: choice }) }).returning().get();
    const prompts: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        const input = { lines: promptEntries(request.prompt) as { id: string }[] };
        return { object: { listeners: input.lines.map((line, index) => ({ id: line.id, listener: index === 0 ? 'Pat' : null, confidence: index === 0 ? 0.95 : 0.4 })) }, usage: {} } as never;
      },
    });
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await runner.drain();

    // The whole cast goes in, the player marked, even though nobody is named in the lines.
    expect(JSON.parse(prompts[0]).cast).toEqual([{ name: 'Alice', aliases: [] }, { name: 'Pat', aliases: [], player: true }]);
    const after = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.sort).all();
    expect(after.map((unit) => [unit.listener, unit.listenerOrigin, unit.listenerConfidence])).toEqual([
      ['Pat', 'ai', 0.95],
      [null, 'ai', 0.4],
      ['Bob', 'human', null],
    ]);
  });
});

describe('listener template', () => {
  it('sends only dialogue lines without a known listener to the model and never overwrites an import listener', async () => {
    const lines = [
      // [kind, listener, origin, confidence]
      ['dialogue', 'Bob', 'import', null],
      ['dialogue', 'Bob', 'human', null],
      ['dialogue', 'Bob', 'ai', 0.95],
      ['dialogue', 'Bob', 'ai', 0.5],
      ['dialogue', null, null, null],
      ['ui', null, null, null],
      ['document', null, null, null],
      ['dialogue', null, null, null],
      // Said to nobody: narration (no speaker) and a line of format tokens only.
      ['narration', null, null, null],
      ['tokens', null, null, null],
    ] as const;
    const db = openDatabase(':memory:');
    const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
    db.update(s.connections).set({ maxOutputTokens: 1000, timeoutSeconds: 30, maxAttempts: 1 }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
    const file = importFileSchema.parse({
      format: 'loca/v1',
      project: { name: 'Test' },
      groups: [{ key: 'g1', title: 'Scene' }],
      units: lines.map(([kind, listener], index) => ({
        key: `u${index}`,
        group: 'g1',
        source: kind === 'tokens' ? '<b></b>' : `Line ${index}`,
        kind: kind === 'narration' || kind === 'tokens' ? 'dialogue' : kind,
        ...(kind !== 'narration' && { speaker: 'Ann' }),
        ...(listener && { listener }),
      })),
    });
    const { projectId } = importProject(db, file, choice);
    const rows = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.sort).all();
    // Importing marks every given listener "import"; set the other origins as the later lines would have them.
    rows.forEach((row, index) => {
      const [, listener, origin, confidence] = lines[index];
      if (listener) db.update(s.units).set({ listenerOrigin: origin, listenerConfidence: confidence }).where(eq(s.units.id, row.id)).run();
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: '청자', definition: listenerTemplate({ model: choice }) }).returning().get();
    const sent: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        const entries = promptEntries(request.prompt) as { id: string; source: string }[];
        sent.push(...entries.map((entry) => entry.source));
        return { object: { listeners: entries.map((entry) => ({ id: entry.id, listener: 'Zed', confidence: 0.95 })) }, usage: {} } as never;
      },
    });
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { ignoreStatus: true } });
    await runner.drain();

    // Import, person, confident AI, non-dialogue, narration and token-only lines are skipped; the unsure AI guess and the two blank dialogue lines are asked.
    expect(sent.sort()).toEqual(['Line 3', 'Line 4', 'Line 7']);
    const after = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.sort).all();
    expect(after.map((unit) => [unit.listener, unit.listenerOrigin])).toEqual([
      ['Bob', 'import'],
      ['Bob', 'human'],
      ['Bob', 'ai'],
      ['Zed', 'ai'],
      ['Zed', 'ai'],
      [null, null],
      [null, null],
      ['Zed', 'ai'],
      [null, null],
      [null, null],
    ]);
  });

  it('setListener alone skips import listeners, non-dialogue, narration and token-only lines', async () => {
    const { syncFunctions } = await import('./functions/index.ts');
    const record = (unit: Record<string, unknown>) => {
      const updates: unknown[] = [];
      const tx = { update: () => ({ set: (values: unknown) => ({ where: () => ({ run: () => updates.push(values) }) }) }), select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) }) };
      const input = { unit, item: { data: { outputs: { n: { listener: 'Zed', confidence: 0.99 } } }, visits: {} } };
      const result = syncFunctions.setListener!(tx as never, { fromNodeId: 'n' }, input as never);
      return { updates, result };
    };
    const line = { kind: 'dialogue', speaker: 'Ann', source: 'Hi', listener: null, listenerOrigin: null };
    expect(record({ ...line, listener: 'Bob', listenerOrigin: 'import' }).updates).toEqual([]);
    expect(record({ ...line, kind: 'ui' }).updates).toEqual([]);
    expect(record({ ...line, speaker: null }).updates).toEqual([]);
    expect(record({ ...line, source: '{0}' }).updates).toEqual([]);
    expect(record(line).updates).toHaveLength(1);
  });
});

describe('knowledge updates', () => {
  it('adds what a scene reveals as AI items, never edits official knowledge, and stays idempotent', async () => {
    const { db, projectId, choice } = setup(3);
    const [alice] = db.insert(s.characters).values([{ projectId, name: 'Alice' }, { projectId, name: 'Bob' }]).returning().all();
    const bob = db.select().from(s.characters).where(eq(s.characters.name, 'Bob')).get()!;
    db.insert(s.relationships).values({ projectId, fromId: alice.id, toId: bob.id, kind: 'friend' }).run();
    db.insert(s.speechRules).values({ projectId, fromName: 'Alice', toName: 'Bob', level: 'hae' }).run();
    const workflow = db.insert(s.workflows).values({ projectId, name: '자료', definition: knowledgeTemplate({ model: choice }) }).returning().get();
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async () =>
        ({
          object: {
            characters: [{ name: 'Carol', aliases: [], profile: 'new' }, { name: 'alice', aliases: [], profile: 'dup' }],
            relationships: [{ from: 'Alice', to: 'Bob', kind: 'friend', description: '', change: 'falls out', at: '2' }],
            events: [{ title: 'Fight', summary: '', outcome: '', participants: ['Alice'], evidence: ['1'] }],
            speechRules: [{ from: 'Alice', to: 'Bob', level: 'haeyo', address: '', note: '', start: null }, { from: 'Alice', to: 'Bob', level: 'hasipsio', address: '', note: '', start: '3' }],
          },
          usage: {},
        }) as never,
    });
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await runner.drain();

    const people = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).all();
    expect(people.map((c) => [c.name, c.origin, c.status])).toEqual([['Alice', 'human', 'confirmed'], ['Bob', 'human', 'confirmed'], ['Carol', 'ai', 'confirmed']]);
    // The official relationship keeps its form; the change waits beside it as a candidate.
    const rels = db.select().from(s.relationships).where(eq(s.relationships.projectId, projectId)).all();
    expect(rels.map((r) => [r.origin, r.status, r.changes.map((c) => c.at)])).toEqual([['human', 'confirmed', []], ['ai', 'candidate', ['u1']]]);
    expect(db.select().from(s.storyEvents).all().map((e) => [e.title, e.evidence])).toEqual([['Fight', ['u0']]]);
    // A different level for the stretch a person decided is a proposal; a new stretch is a new AI rule.
    const rules = db.select().from(s.speechRules).where(eq(s.speechRules.projectId, projectId)).all();
    expect(rules.map((r) => [r.level, r.startKey, r.origin, r.status])).toEqual([
      ['hae', null, 'human', 'confirmed'],
      ['haeyo', null, 'ai', 'candidate'],
      ['hasipsio', 'u2', 'ai', 'confirmed'],
    ]);
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

    const { db, projectId, choice } = setup(3);
    const tool = db.insert(s.connections).values({ kind: 'http', name: 'speller', headerTemplate: 'X-Key: {key}' }).returning().get();
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const confirmed = statuses.find((status) => status.kind === 'final')!;
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'terms', type: 'ai', position: { x: 0, y: 0 }, config: { model: choice, output: 'terms', instructions: AI_PRESETS.terms.instructions } },
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
        { id: 'http', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'http', params: { url: `http://127.0.0.1:${port}/spell`, connectionId: tool.id, body: '{ "text": "{{candidate}}" }', resultPath: 'result.text' } } },
        { id: 'confirm', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus', params: { statusId: confirmed.id } } },
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
    // Already in the glossary with an empty translation: kept, and only its empty fields are filled.
    db.insert(s.terms).values({ projectId, source: 'directorate', target: '', note: '', status: 'candidate', origin: 'script' }).run();
    const workflow = db.insert(s.workflows).values({ projectId, name: 'functions', definition }).returning().get();
    const runner = new Runner(db, memoryStore(), fakeModel());
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
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
    // New terms are added once, confirmed by AI (AI › 사용 방식 default); a known one (any case) is not added again, only filled.
    const terms = db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all();
    expect(terms.map((term) => [term.source, term.target, term.note, term.status, term.statusBy])).toEqual([
      ['directorate', '총국', '기관', 'candidate', 'human'],
      ['Line', '줄', '', 'confirmed', 'ai'],
    ]);
    // The run set every line's status: AI, with the run.
    expect(units.map((unit) => [unit.statusBy, unit.statusRunId])).toEqual(units.map(() => ['ai', runId]));
    expect(db.select().from(s.candidates).where(eq(s.candidates.origin, 'tool')).all()).toHaveLength(4);
  });

  it('stops a runaway script and reports it as an error', async () => {
    const { db, projectId, choice } = setup(1);
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
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await new Runner(db, memoryStore(), fakeModel()).drain();
    const [item] = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(item.state).toBe('failed');
    expect(item.error).toContain('초 안에 끝나지 않았습니다');
  });
});

describe('who set the status', () => {
  const confirmFlow = (statusId: string) =>
    workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'confirm', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'setStatus', params: { statusId } } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'confirm' },
        { id: '2', source: 'confirm', sourceHandle: 'out', target: 'end' },
      ],
    });
  const noModel: ModelPort = { judge: async () => { throw new Error('unused'); }, generate: async () => { throw new Error('unused'); } };

  it('sends a line to the review inbox instead of a status only a person may set, and says why', async () => {
    const { db, projectId } = setup(2);
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const final = statuses.find((status) => status.kind === 'final')!;
    const inbox = statuses.find((status) => status.inReview)!;
    db.update(s.statuses).set({ humanOnly: true }).where(eq(s.statuses.id, final.id)).run();
    const workflow = db.insert(s.workflows).values({ projectId, name: '확정', definition: confirmFlow(final.id) }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: {}, scope: {} });
    await new Runner(db, memoryStore(), noModel).drain();

    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    expect(units.map((unit) => [unit.statusId, unit.statusBy, unit.statusRunId])).toEqual(units.map(() => [inbox.id, 'ai', runId]));
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.data.issues?.[0]?.includes('사람만 지정할 수 있어 검토함으로 보냈습니다'))).toBe(true);

    // Without a review-inbox status the line stays where it was, with the same reason.
    db.update(s.statuses).set({ inReview: false }).where(eq(s.statuses.projectId, projectId)).run();
    const before = units[0].statusId;
    const again = createRun(db, { projectId, workflow, models: {}, scope: { unitIds: [units[0].id], ignoreStatus: true } });
    await new Runner(db, memoryStore(), noModel).drain();
    expect(db.select().from(s.units).where(eq(s.units.id, units[0].id)).get()!.statusId).toBe(before);
    expect(db.select().from(s.runItems).where(eq(s.runItems.runId, again.runId)).get()!.data.issues?.[0]).toContain('상태를 바꾸지 않았습니다');
  });

  it('keeps a person\'s translation and status in a status-filtered run, and only reports it', async () => {
    const { syncFunctions } = await import('./functions/index.ts');
    const { db, projectId } = setup(1);
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const statuses = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all();
    const initial = statuses.find((status) => status.kind === 'initial')!;
    const final = statuses.find((status) => status.kind === 'final')!;
    const call = (data: Record<string, unknown>) =>
      db.transaction((tx) => syncFunctions.setStatus!(tx as never, { statusId: final.id }, { unit, item: { data }, tagIds: [], projectId, runId: 'r' } as never));

    // A person saved '내 번역' after the run started: the run keeps their text and status (#51).
    db.update(s.units).set({ translation: '내 번역', statusBy: 'human' }).where(eq(s.units.id, unit.id)).run();
    const kept = call({ candidateId: 'c1', candidateText: 'AI 번역' });
    expect(kept.issues?.[0]).toContain('사람이 저장한 번역이 있어 바꾸지 않았습니다');
    const row = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect([row.translation, row.candidateId, row.statusBy, row.statusId]).toEqual(['내 번역', unit.candidateId, 'human', initial.id]);

    // AI owns the line: the status changes; the text was already written by the node that produced it.
    db.update(s.units).set({ translation: 'AI 초벌', statusBy: 'ai' }).where(eq(s.units.id, unit.id)).run();
    call({ candidateId: 'c2', candidateText: 'AI 번역 2' });
    const after = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect([after.translation, after.statusBy, after.statusId]).toEqual(['AI 초벌', 'ai', final.id]);
  });

  it('protects a person\'s translation only in runs that pick lines by status', async () => {
    const { filtersByStatus } = await import('@tw/shared');
    const entry = (statusIds: string[]) => ({ nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds } }], edges: [] }) as never;
    expect(filtersByStatus(entry(['untranslated']), {})).toBe(true);
    // '상태 무시' or a workflow without a status filter (말투만 고치기) is asked to rewrite the lines it names.
    expect(filtersByStatus(entry(['untranslated']), { ignoreStatus: true })).toBe(false);
    expect(filtersByStatus(entry([]), {})).toBe(false);
  });
});

describe('writing a produced translation to the line', () => {
  it('writes text, candidate and AI ownership; keeps a person\'s text in a status-filtered run; overwrites when status is ignored', async () => {
    const { applyRunCandidate } = await import('./apply-candidate.ts');
    const { db, projectId } = setup(1);
    const unit = db.select().from(s.units).where(eq(s.units.projectId, projectId)).get()!;
    const initial = db.select().from(s.statuses).where(eq(s.statuses.projectId, projectId)).all().find((status) => status.kind === 'initial')!;
    const definition = workflowDefinitionSchema.parse({
      nodes: [{ id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: { statusIds: [initial.id] } }],
      edges: [],
    });
    const run = { id: 'r1', projectId, definition, scope: {} } as never;
    const apply = (target: string, candidateId: string, text: string) => db.transaction((tx) => applyRunCandidate(tx as never, run, target, candidateId, text));

    // A fresh line gets the produced text and AI ownership.
    expect(apply(unit.id, 'c1', 'AI 번역 1')).toEqual({ applied: true });
    let row = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect([row.translation, row.candidateId, row.statusBy, row.statusRunId]).toEqual(['AI 번역 1', 'c1', 'ai', 'r1']);

    // A person's saved translation in a status-filtered run is kept.
    db.update(s.units).set({ translation: '내 번역', statusBy: 'human', statusRunId: null }).where(eq(s.units.id, unit.id)).run();
    expect(apply(unit.id, 'c2', 'AI 번역 2')).toEqual({ applied: false });
    row = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect([row.translation, row.statusBy]).toEqual(['내 번역', 'human']);

    // A run told to ignore status may rewrite the line.
    const open = { ...(run as object), scope: { ignoreStatus: true } } as never;
    expect(db.transaction((tx) => applyRunCandidate(tx as never, open, unit.id, 'c3', 'AI 번역 3'))).toEqual({ applied: true });
    row = db.select().from(s.units).where(eq(s.units.id, unit.id)).get()!;
    expect([row.translation, row.candidateId, row.statusBy]).toEqual(['AI 번역 3', 'c3', 'ai']);
  });
});

describe('batch output optimization (H7)', () => {
  it('marks the batch leader, skips duplicate addTerms writes, and keeps payload on leader only for knowledge', async () => {
    const { db, projectId, choice } = setup(3);
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'terms', type: 'ai', position: { x: 0, y: 0 }, config: { model: choice, output: 'terms', instructions: AI_PRESETS.terms.instructions } },
        { id: 'add', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'addTerms', params: { fromNodeId: 'terms' } } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'terms' },
        { id: '2', source: 'terms', sourceHandle: 'out', target: 'add' },
        { id: '3', source: 'add', sourceHandle: 'out', target: 'end' },
      ],
    });

    const model: ModelPort = {
      judge: async () => { throw new Error('unused'); },
      generate: (async () => ({
        object: { terms: [{ source: 'artifact', target: '유물', note: 'ancient tool' }] },
        usage: { inputTokens: 50, outputTokens: 20 },
      })) as never,
    };

    const workflow = db.insert(s.workflows).values({ projectId, name: 'terms-flow', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await new Runner(db, memoryStore(), model).drain();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items).toHaveLength(3);
    // Leader gets batchLeader: true; other members get batchLeader: false.
    expect(items[0].data.outputs?.terms).toMatchObject({ terms: [{ source: 'artifact', target: '유물' }], batchLeader: true });
    expect(items[1].data.outputs?.terms).toMatchObject({ terms: [{ source: 'artifact', target: '유물' }], batchLeader: false });
    expect(items[2].data.outputs?.terms).toMatchObject({ terms: [{ source: 'artifact', target: '유물' }], batchLeader: false });

    // The function node executed for all 3, but leader inserted and followers skipped redundant writes.
    expect(items[0].data.outputs?.add).toMatchObject({ added: 1, filled: 0 });
    expect(items[1].data.outputs?.add).toMatchObject({ added: 0, filled: 0, batchSkipped: true });
    expect(items[2].data.outputs?.add).toMatchObject({ added: 0, filled: 0, batchSkipped: true });

    // Terms table has exactly 1 term inserted, not 3.
    const terms = db.select().from(s.terms).where(eq(s.terms.projectId, projectId)).all();
    expect(terms).toHaveLength(1);
    expect(terms[0].source).toBe('artifact');
  });

  it('preserves model evidence and saves space by keeping knowledge payload on leader only', async () => {
    const { db, projectId, choice } = setup(2);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    const secondLineKey = units[1].key;

    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: { x: 0, y: 0 }, config: {} },
        { id: 'know', type: 'ai', position: { x: 0, y: 0 }, config: { model: choice, output: 'knowledge', instructions: AI_PRESETS.knowledge.instructions } },
        { id: 'apply', type: 'function', position: { x: 0, y: 0 }, config: { fn: 'applyKnowledge', params: { fromNodeId: 'know' } } },
        { id: 'end', type: 'end', position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'know' },
        { id: '2', source: 'know', sourceHandle: 'out', target: 'apply' },
        { id: '3', source: 'apply', sourceHandle: 'out', target: 'end' },
      ],
    });

    const model: ModelPort = {
      judge: async () => { throw new Error('unused'); },
      generate: (async () => ({
        object: {
          characters: [{ name: 'Cassandra', aliases: ['Cass'], profile: 'Detective', evidence: ['2'] }],
          relationships: [],
          events: [{ title: 'Secret meeting', summary: 'met in the dark', outcome: 'discovered', participants: ['Cassandra'], evidence: ['2'] }],
          speechRules: [],
        },
        usage: { inputTokens: 50, outputTokens: 20 },
      })) as never,
    };

    const workflow = db.insert(s.workflows).values({ projectId, name: 'know-flow', definition }).returning().get();
    const { runId } = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await new Runner(db, memoryStore(), model).drain();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items).toHaveLength(2);

    // Leader carries the full knowledge graph.
    expect((items[0].data.outputs?.know as { knowledge: { characters: unknown[] } }).knowledge.characters).toHaveLength(1);
    expect((items[0].data.outputs?.know as { batchLeader: boolean }).batchLeader).toBe(true);

    // Follower carries empty knowledge to save space in run_items.data.
    expect((items[1].data.outputs?.know as { knowledge: { characters: unknown[] } }).knowledge.characters).toHaveLength(0);
    expect((items[1].data.outputs?.know as { batchLeader: boolean }).batchLeader).toBe(false);

    // apply node: leader applied, follower skipped redundant writes.
    expect(items[0].data.outputs?.apply).toMatchObject({ added: 2 }); // 1 character + 1 event
    expect(items[1].data.outputs?.apply).toMatchObject({ added: 0, proposed: 0, batchSkipped: true });

    // Character evidence correctly points to line 2's key, not line 1's key!
    const character = db.select().from(s.characters).where(eq(s.characters.projectId, projectId)).get();
    expect(character?.name).toBe('Cassandra');
    expect(character?.evidence).toEqual([secondLineKey]);
  });
});


