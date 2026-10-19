import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { importFileSchema, workflowDefinitionSchema } from '@tw/shared';
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
  const confirmed = statuses.find((s) => s.kind === 'final')!;
  return { db, projectId, choice, needsReview, confirmed };
}

const at = { x: 0, y: 0 };
/** An AI node's config with the model chosen. */
const ai = (choice: unknown, config: Record<string, unknown>) => ({ type: 'ai', position: at, config: { model: choice, ...config } });
const fn = (name: string, params: Record<string, unknown> = {}) => ({ type: 'function', position: at, config: { fn: name, params } });
/** Nodes by id with edges "from.port -> to". */
const flow = (nodes: Record<string, object>, edges: string[]) =>
  workflowDefinitionSchema.parse({
    nodes: [{ id: 'entry', type: 'entry', position: at, config: {} }, ...Object.entries(nodes).map(([id, node]) => ({ id, ...node })), { id: 'end', type: 'end', position: at }],
    edges: edges.map((edge, index) => {
      const [from, to] = edge.split(' -> ');
      const [source, sourceHandle = 'out'] = from.split('.');
      return { id: String(index), source, sourceHandle, target: to };
    }),
  });
const save = (db: ReturnType<typeof setup>['db'], projectId: string, definition: ReturnType<typeof flow>, name = 'test') => db.insert(s.workflows).values({ projectId, name, definition }).returning().get();
const start = (db: ReturnType<typeof setup>['db'], projectId: string, workflow: ReturnType<typeof save>, scope = {}) => createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope });
const noModel: ModelPort = { judge: async () => { throw new Error('unused'); }, generate: async () => { throw new Error('unused'); } };

/** Lines 1–3 fail review until revised three times. */
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
          results: input.lines.map((line) => {
            if (kind === 'revise') revisions.set(line.source, (revisions.get(line.source) ?? 0) + 1);
            return { id: line.id, text: `[${kind}] ${line.source}` };
          }),
        },
        usage: {},
      } as never;
    },
  };
}

/** Translate, review; failing lines are revised twice, then sent to the review status. */
function reviewFlow(choice: unknown, confirmed: string, needsReview: string) {
  return flow(
    {
      translate: ai(choice, { output: 'text', instructions: 'Translate.' }),
      review: ai(choice, { output: 'verdict', instructions: 'Review each translation.' }),
      confirm: fn('setStatus', { statusId: confirmed }),
      again: { type: 'condition', position: at, config: { expression: { '<': [{ var: 'visits.review' }, 3] } } },
      revise: ai(choice, { output: 'text', instructions: 'Revise each translation to fix the issues.' }),
      escalate: fn('setStatus', { statusId: needsReview }),
    },
    ['entry -> translate', 'translate -> review', 'review.pass -> confirm', 'review.fail -> again', 'again.true -> revise', 'revise -> review', 'again.false -> escalate', 'confirm -> end'],
  );
}

describe('workflow runner', () => {
  it('routes passing lines on, revises failures, then hands the rest to the review status', async () => {
    const { db, projectId, choice, needsReview, confirmed } = setup();
    const model = fakeModel();
    const runner = new Runner(db, memoryStore(), model);
    const workflow = save(db, projectId, reviewFlow(choice, confirmed.id, needsReview.id));
    const { runId, total } = start(db, projectId, workflow);
    expect(total).toBe(30);
    await runner.drain();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    const statuses = new Map(db.select().from(s.statuses).all().map((status) => [status.id, status.name]));
    const units = new Map(db.select().from(s.units).all().map((unit) => [unit.id, unit]));
    expect(items.filter((item) => item.state === 'done')).toHaveLength(30);
    const escalated = items.filter((item) => item.nodeId === 'escalate');
    expect(escalated).toHaveLength(3);
    for (const item of escalated) {
      // Review ran three times and failed each time; the condition allows two revisions in between.
      expect(item.visits.review).toBe(3);
      expect(item.visits.revise).toBe(2);
      expect(item.data.issues).toEqual(['어색함']);
      expect(item.data.candidateText).toBe(`[revise] ${units.get(item.unitId)!.source}`);
      expect(statuses.get(units.get(item.unitId)!.statusId)).toBe('사람 확인 필요');
    }
    // Batches are per scene (size 30), so each pass over 30 lines is one call.
    expect(model.calls.filter((call) => call === 'translate')).toHaveLength(1);
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('a text answer is only the run\'s working text: the line itself and its candidates are not written', async () => {
    const { db, projectId, choice, needsReview, confirmed } = setup(4);
    const runner = new Runner(db, memoryStore(), fakeModel());
    const workflow = save(db, projectId, reviewFlow(choice, confirmed.id, needsReview.id));
    const { runId } = start(db, projectId, workflow);
    await runner.drain();

    const candidatesBefore = db.select().from(s.candidates).all().length;
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    expect(units.every((unit) => unit.translation === null && unit.candidateId === null)).toBe(true);
    expect(db.select().from(s.candidates).all()).toHaveLength(candidatesBefore);
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.data.candidateText?.startsWith('[') && item.data.candidateId === undefined)).toBe(true);
    // The latest text is what the next node reads as the line's candidate.
    const first = items.find((item) => item.data.outputs?.translate && !item.data.outputs.revise)!;
    expect(first.data.outputs!.translate).toEqual({ text: expect.stringMatching(/^\[translate\]/) });
  });

  it('marks the batch failed with the model error when no route works', async () => {
    const { db, projectId, choice, needsReview, confirmed } = setup(2);
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async () => {
        throw new Error('인증 실패');
      },
    });
    const workflow = save(db, projectId, reviewFlow(choice, confirmed.id, needsReview.id));
    const { runId } = start(db, projectId, workflow);
    await runner.drain();
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'failed' && item.error?.includes('인증 실패'))).toBe(true);
    const steps = db.select().from(s.runSteps).where(eq(s.runSteps.runId, runId)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0].ok).toBe(false);
  });
});

describe('choice output', () => {
  it('asks with the resolved options (cast + special listeners), keeps value and confidence as the node output and writes nothing', async () => {
    const { db, projectId, choice } = setup(3);
    db.update(s.units).set({ speaker: 'Ann' }).where(eq(s.units.projectId, projectId)).run();
    db.insert(s.characters).values([{ projectId, name: 'Alice' }, { projectId, name: 'Pat', player: true }, { projectId, name: 'Maybe', status: 'candidate' }]).run();
    const definition = flow(
      { listener: ai(choice, { output: 'choice', instructions: 'Who is the listener?', choice: { source: 'characters', values: [], allowNone: true }, context: { cast: true } }) },
      ['entry -> listener', 'listener -> end'],
    );
    const workflow = save(db, projectId, definition);
    const seen: { system: string; prompt: string; schema: unknown }[] = [];
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        seen.push({ system: request.system, prompt: request.prompt, schema: request.schema });
        const entries = promptEntries(request.prompt) as { id: string }[];
        return { object: { results: entries.map((entry, index) => ({ id: entry.id, value: index === 0 ? 'Pat' : index === 1 ? 'Nobody' : null, confidence: 0.95 })) }, usage: {} } as never;
      },
    });
    const { runId } = start(db, projectId, workflow, { ignoreStatus: true });
    await runner.drain();

    expect(seen[0].system).toContain('Options for "value": "Alice", "Pat", "group", "public", "self". Use null when none of them fits.');
    expect(JSON.parse(seen[0].prompt).cast).toEqual([{ name: 'Alice', aliases: [] }, { name: 'Pat', aliases: [], player: true }]);
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.map((item) => item.data.outputs?.listener)).toEqual([{ value: 'Pat', confidence: 0.95 }, { value: null, confidence: 0.95 }, { value: null, confidence: 0.95 }]);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    expect(units.every((unit) => unit.listener === null)).toBe(true);
  });
});

describe('json output', () => {
  it('line scope: fields per line, evidence as line keys; a line the answer left out is asked again', async () => {
    const { db, projectId, choice } = setup(3);
    const definition = flow(
      { tone: ai(choice, { output: 'json', instructions: 'Describe.', fields: [{ name: 'tone', type: 'string' }, { name: 'because', type: 'lines' }], batch: { mode: 'count', size: 3, maxTokens: 6000 } }) },
      ['entry -> tone', 'tone -> end'],
    );
    const workflow = save(db, projectId, definition);
    let calls = 0;
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: async (_route, request) => {
        calls += 1;
        const entries = promptEntries(request.prompt) as { id: string }[];
        // The first call leaves the last line out.
        const answered = calls === 1 ? entries.slice(0, -1) : entries;
        return { object: { results: answered.map((entry) => ({ id: entry.id, tone: `t${entry.id}`, because: ['1', 'x'] })) }, usage: {} } as never;
      },
    });
    const { runId } = start(db, projectId, workflow);
    await runner.drain();
    expect(calls).toBe(2);
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).orderBy(s.units.sort).all();
    const byUnit = new Map(items.map((item) => [item.unitId, item.data.outputs!.tone]));
    // "1" is the first line of the request each time; its key is that request's first line's.
    expect(byUnit.get(units[0].id)).toEqual({ tone: 't1', because: [units[0].key] });
    expect(byUnit.get(units[1].id)).toMatchObject({ tone: 't2' });
  });

  it('batch scope: one answer for the request, carried by the first line only (batchLeader)', async () => {
    const { db, projectId, choice } = setup(3);
    const definition = flow(
      {
        terms: ai(choice, {
          output: 'json',
          scope: 'batch',
          instructions: 'Find terms.',
          fields: [{ name: 'terms', type: 'list', fields: [{ name: 'source', type: 'string' }, { name: 'evidence', type: 'lines' }] }],
        }),
      },
      ['entry -> terms', 'terms -> end'],
    );
    const workflow = save(db, projectId, definition);
    const seen: { system: string }[] = [];
    const runner = new Runner(db, memoryStore(), {
      judge: async () => {
        throw new Error('unused');
      },
      generate: (async (_route: unknown, request: { system: string }) => {
        seen.push(request);
        return { object: { terms: [{ source: 'artifact', evidence: ['2'] }] }, usage: {} };
      }) as never,
    });
    const { runId } = start(db, projectId, workflow);
    await runner.drain();
    expect(seen).toHaveLength(1);
    expect(seen[0].system).toContain('Answer as one JSON object');
    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    const units = new Map(db.select().from(s.units).where(eq(s.units.projectId, projectId)).all().map((unit) => [unit.id, unit]));
    const outputs = items.sort((a, b) => units.get(a.unitId)!.seq - units.get(b.unitId)!.seq).map((item) => item.data.outputs!.terms);
    expect(outputs).toEqual([
      { terms: [{ source: 'artifact', evidence: [expect.stringMatching(/^u\d$/)] }], batchLeader: true },
      { batchLeader: false },
      { batchLeader: false },
    ]);
    expect(items.every((item) => item.state === 'done')).toBe(true);
  });
});

describe('function nodes', () => {
  it('chains an AI text, a sandboxed script and an HTTP tool; the produced text stays the run\'s working text', async () => {
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

    const { db, projectId, choice, confirmed } = setup(3);
    const tool = db.insert(s.connections).values({ kind: 'http', name: 'speller', headerTemplate: 'X-Key: {key}' }).returning().get();
    const definition = flow(
      {
        translate: ai(choice, { output: 'text', instructions: 'Translate.' }),
        script: {
          type: 'function',
          position: at,
          config: {
            fn: 'script',
            params: {
              ports: ['first', 'other'],
              code: 'export default function run(input) { return { candidate: "[" + input.outputs.translate.text + "]", port: input.unit.source === "Hi {name}" ? "first" : "other", data: { length: input.outputs.translate.text.length } }; }',
            },
          },
        },
        http: fn('http', { url: `http://127.0.0.1:${port}/spell`, connectionId: tool.id, body: '{ "text": "{{candidate}}" }', resultPath: 'result.text' }),
        confirm: fn('setStatus', { statusId: confirmed.id }),
      },
      ['entry -> translate', 'translate -> script', 'script.first -> http', 'script.other -> confirm', 'http -> confirm', 'confirm -> end'],
    );
    const workflow = save(db, projectId, definition);
    const runner = new Runner(db, memoryStore(), fakeModel());
    const { runId } = start(db, projectId, workflow);
    await runner.drain();
    server.close();

    const items = db.select().from(s.runItems).where(eq(s.runItems.runId, runId)).all();
    expect(items.map((item) => item.state)).toEqual(['done', 'done', 'done']);
    const units = db.select().from(s.units).where(eq(s.units.projectId, projectId)).all();
    const byKey = new Map(units.map((unit) => [unit.key, unit]));
    const textOf = (key: string) => items.find((item) => item.unitId === byKey.get(key)!.id)!.data.candidateText;
    // Only the first line took the "first" exit through the HTTP tool, which appended "!".
    expect(textOf('u0')).toBe('[[translate] Hi {name}]!');
    expect(textOf('u1')).toBe('[[translate] Line 1]');
    expect(received).toEqual([{ text: '[[translate] Hi {name}]' }]);
    expect(items[0].data.outputs?.script).toEqual({ length: '[translate] Hi {name}'.length });
    // Nothing wrote the lines' translation (that is an apply node's job); the run set every line's status: AI, with the run.
    expect(units.every((unit) => unit.translation === null)).toBe(true);
    expect(units.map((unit) => [unit.statusBy, unit.statusRunId])).toEqual(units.map(() => ['ai', runId]));
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
    expect(items.every((item) => item.data.issues?.[0]?.includes('워크플로가 지정하지 않는 상태라 검토함으로 보냈습니다'))).toBe(true);

    // Without a review-inbox status the line stays where it was, with the same reason.
    db.update(s.statuses).set({ inReview: false }).where(eq(s.statuses.projectId, projectId)).run();
    const before = units[0].statusId;
    const again = createRun(db, { projectId, workflow, models: {}, scope: { unitIds: [units[0].id], ignoreStatus: true } });
    await new Runner(db, memoryStore(), noModel).drain();
    expect(db.select().from(s.units).where(eq(s.units.id, units[0].id)).get()!.statusId).toBe(before);
    expect(db.select().from(s.runItems).where(eq(s.runItems.runId, again.runId)).get()!.data.issues?.[0]).toContain('상태라 바꾸지 않았습니다');
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
