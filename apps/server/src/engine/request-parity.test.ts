import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { estimateTokens, importFileSchema, LINE_OVERHEAD, workflowDefinitionSchema } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { importProject } from '../services/importer.ts';
import { preflight } from './preflight.ts';
import { previewContext, previewRequest } from '../services/request-preview.ts';
import { snapshotWorkflowModels } from '../domain/model-target.ts';
import { memoryStore } from '../domain/secrets.ts';
import { createRun } from './run-create.ts';
import { Runner, type ModelPort } from './runner.ts';

/*
 * The guard of "one request builder": for the same project, node and lines, what a preview shows is,
 * character for character, what the model port receives in a run. One case per shape of request.
 */

const HARBOR = Array.from({ length: 18 }, (_, index) => `Harbor order ${index + 1}: mind the tide and the ropes.`);
const DECK = 'Aye, I heard her shouting.';
const MARKET = Array.from({ length: 6 }, (_, index) => `Market cry ${index + 1}: fresh fish, two coins each.`);

/** Three scenes: Harbor (Alice), Deck (Bob; the dialogue graph leads there from Harbor) and Market (Carol, linked to nothing), plus a line no run takes ("..."). */
function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  const choice = { connectionId: connection.id, model: 'm' };
  const units = [
    ...HARBOR.map((source, index) => ({ key: `h${index + 1}`, group: 'harbor', speaker: 'Alice', source })),
    { key: 'd1', group: 'deck', speaker: 'Bob', source: DECK },
    { key: 'd2', group: 'deck', speaker: 'Bob', source: '...' },
    ...MARKET.map((source, index) => ({ key: `m${index + 1}`, group: 'market', speaker: 'Carol', source })),
  ];
  const file = importFileSchema.parse({
    format: 'loca/v1',
    project: { name: 'Parity' },
    groups: [
      { key: 'harbor', title: 'Harbor', section: 'Ch 1' },
      { key: 'deck', title: 'Deck', section: 'Ch 1' },
      { key: 'market', title: 'Market', section: 'Ch 2' },
    ],
    units,
    graph: {
      nodes: [
        { key: 'n.harbor', units: HARBOR.map((_, index) => `h${index + 1}`) },
        { key: 'n.deck', units: ['d1', 'd2'] },
        { key: 'n.market', units: MARKET.map((_, index) => `m${index + 1}`) },
      ],
      edges: [{ from: 'n.harbor', to: 'n.deck' }],
    },
  });
  const { projectId } = importProject(db, file, choice);
  db.insert(s.characters).values([{ projectId, name: 'Alice' }, { projectId, name: 'Bob' }]).run();
  return { db, projectId, choice, taken: units.filter((unit) => unit.source !== '...').map((unit) => unit.key) };
}

const at = { x: 0, y: 0 };
const flow = (choice: unknown, config: Record<string, unknown>, input: 'lines' | 'terms' = 'lines') =>
  workflowDefinitionSchema.parse({
    nodes: [
      { id: 'entry', type: 'entry', position: at, config: { input } },
      { id: 'ask', type: 'ai', position: at, config: { model: choice, instructions: 'Do the work.', context: { precedingLines: 3, glossary: true, characters: true }, ...config } },
    ],
    edges: [{ id: '1', source: 'entry', sourceHandle: 'out', target: 'ask' }],
    // No resends: every request of the run is a first request, as a preview shows it.
    settings: { retries: [] },
  });

type Db = ReturnType<typeof setup>['db'];

/** Runs the workflow over everything and returns what the model port was sent, request by request. */
async function sentBy(db: Db, projectId: string, definition: ReturnType<typeof flow>, answer: unknown = { results: [] }) {
  const workflow = db.insert(s.workflows).values({ projectId, name: `w${db.select().from(s.workflows).all().length}`, definition }).returning().get();
  const sent: string[] = [];
  const port: ModelPort = {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_target, request) => {
      sent.push(`${request.system}\n\n${request.prompt}`);
      return { object: answer, usage: {} } as never;
    },
  };
  createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
  await new Runner(db, memoryStore(), port).drain();
  return { workflow, sent };
}

/** The preview of the request that holds `sample` (a line key or a term id), as one text. */
function shown(db: Db, workflow: typeof s.workflows.$inferSelect, sample: string) {
  const preview = previewRequest(db, workflow, 'ask', sample)!;
  expect(preview.unavailable).toBeNull();
  return { text: `${preview.system}\n\n${preview.prompt}`, total: preview.total };
}

describe('a preview shows the request a run sends, character for character', () => {
  it('a node that sends one line per request', async () => {
    const { db, projectId, choice, taken } = setup();
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, { output: 'text', batch: { mode: 'unit' } }));
    expect(sent).toHaveLength(taken.length);
    expect(taken.map((key) => shown(db, workflow, key).text)).toEqual(sent);
  });

  it('a node that sends lines in fixed counts: the line no run takes is in no request, and shifts none', async () => {
    const { db, projectId, choice, taken } = setup();
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, { output: 'text', batch: { mode: 'count', size: 2 } }));
    expect(sent).toHaveLength(Math.ceil(taken.length / 2));
    expect(new Set(taken.map((key) => shown(db, workflow, key).text))).toEqual(new Set(sent));
    // d1 travels with the next line a run takes (m1), not with the excluded d2 between them.
    expect(shown(db, workflow, 'd1').text).toBe(shown(db, workflow, 'm1').text);
    expect(sent.every((text) => !text.includes('"source":"..."'))).toBe(true);
  });

  it('a node that sends scenes together: scenes the dialogue graph links share a request, as in the run', async () => {
    const { db, projectId, choice, taken } = setup();
    // A request holds Harbor and Deck and no more. Harbor alone is more than half of it, so Deck (another speaker) is planned
    // with it only because the graph leads there; unlinked, Deck would start the next request and travel with Market.
    const cost = (sources: string[]) => sources.reduce((sum, source) => sum + estimateTokens(source) + LINE_OVERHEAD, 0);
    const maxTokens = cost(HARBOR) + cost([DECK]) + 5;
    expect(maxTokens).toBeGreaterThanOrEqual(500);
    expect(cost(MARKET) * 4).toBeGreaterThan(maxTokens);
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, { output: 'text', batch: { mode: 'group', maxTokens } }));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain(HARBOR.at(-1));
    expect(sent[0]).toContain(DECK);
    expect(sent[0]).not.toContain(MARKET[0]);
    expect(new Set(taken.map((key) => shown(db, workflow, key).text))).toEqual(new Set(sent));
    expect(shown(db, workflow, 'd1')).toEqual({ text: sent[0], total: HARBOR.length + 1 });
    expect(shown(db, workflow, 'm2')).toEqual({ text: sent[1], total: MARKET.length });
    // `loca context` shows the same request, and the run estimate sizes the same requests.
    const context = previewContext(db, projectId, 'd1', { workflowId: workflow.id, nodeId: 'ask' })!;
    expect('batch' in context && `${context.system}\n\n${context.prompt}`).toBe(sent[0]);
    expect('batch' in context && context.batch.keys).toEqual([...HARBOR.map((_, index) => `h${index + 1}`), 'd1']);
    const estimate = (await preflight(db, workflow, {})).nodes[0]!;
    expect(estimate.full).toBe(2);
    expect(estimate.promptTokens).toBe(Math.round(sent.reduce((sum, text) => sum + estimateTokens(text), 0) / sent.length));
  });

  it('a node that reads the script whole', async () => {
    const { db, projectId, choice, taken } = setup();
    const config = { output: 'json', scope: 'batch', fields: [{ name: 'people', type: 'list', fields: [{ name: 'name', type: 'string' }] }], batch: { mode: 'whole', maxTokens: 300_000 } };
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, config), { people: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('SCRIPT:');
    expect(sent[0]).not.toContain('Bob: ...');
    for (const key of taken) expect(shown(db, workflow, key)).toEqual({ text: sent[0], total: taken.length });
  });

  it('a node that picks from options read from the project', async () => {
    const { db, projectId, choice, taken } = setup();
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, { output: 'choice', choice: { source: 'characters', allowNone: true }, batch: { mode: 'count', size: 4 } }));
    // 25 lines in fours; the one left over rides with the last four, as the runner packs a small remnant.
    expect(sent).toHaveLength(6);
    expect(sent[0]).toContain('Alice');
    expect(new Set(taken.map((key) => shown(db, workflow, key).text))).toEqual(new Set(sent));
  });

  it('a terms workflow: terms most used first, in the node\'s counts', async () => {
    const { db, projectId, choice } = setup();
    db.delete(s.terms).where(eq(s.terms.projectId, projectId)).run();
    const term = (source: string, examples: string[], extra: Partial<typeof s.terms.$inferInsert> = {}) => db.insert(s.terms).values({ projectId, source, status: 'candidate', origin: 'script', statusBy: 'ai', examples, ...extra }).returning().get();
    const terms = [term('tide', ['h1', 'h2', 'h3']), term('ropes', ['h2']), term('Harbor order', ['h3']), term('coins', ['m1']), term('fish', ['m2'])];
    term('Market cry', ['m1'], { status: 'rejected' });
    const config = { output: 'json', scope: 'line', fields: [{ name: 'target', type: 'string' }], batch: { mode: 'count', size: 2 }, context: { glossary: true, examples: 2 } };
    const { workflow, sent } = await sentBy(db, projectId, flow(choice, config, 'terms'));
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain('"kind":"term"');
    expect(new Set(terms.map((row) => shown(db, workflow, row.id).text))).toEqual(new Set(sent));
    // A rejected term is in no run, so there is no request to show for it.
    const rejected = db.select().from(s.terms).where(eq(s.terms.source, 'Market cry')).get()!;
    expect(previewRequest(db, workflow, 'ask', rejected.id)).toMatchObject({ unavailable: expect.stringContaining('실행에 들어가지 않는'), prompt: '', system: '' });
  });
});

describe('what a preview cannot show, it says', () => {
  it('a line no run takes has no request', () => {
    const { db, projectId, choice } = setup();
    const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition: flow(choice, { output: 'text', batch: { mode: 'count', size: 2 } }) }).returning().get();
    expect(previewRequest(db, workflow, 'ask', 'd2')).toMatchObject({ sample: { value: 'd2' }, unavailable: expect.stringContaining('번역 제외'), prompt: '', system: '', total: 0 });
    expect(previewContext(db, projectId, 'd2', { workflowId: workflow.id, nodeId: 'ask' })).toMatchObject({ unavailable: expect.stringContaining('번역 제외') });
    // Without a sample the preview starts from the first line a run takes.
    expect(previewRequest(db, workflow, 'ask')).toMatchObject({ sample: { value: 'h1' }, unavailable: null });
  });

  it('a node that reads an earlier node\'s result is not imitated from the lines alone', () => {
    const { db, projectId, choice } = setup();
    const definition = workflowDefinitionSchema.parse({
      nodes: [
        { id: 'entry', type: 'entry', position: at, config: {} },
        { id: 'find', type: 'ai', position: at, config: { model: choice, instructions: 'Find people.', output: 'json', scope: 'batch', fields: [{ name: 'people', type: 'strings' }] } },
        { id: 'ask', type: 'ai', position: at, config: { model: choice, instructions: 'Use what was found.', output: 'text', input: { previous: true } } },
        { id: 'all', type: 'gather', position: at, config: {} },
        { id: 'merge', type: 'ai', position: at, config: { model: choice, instructions: 'Merge.', output: 'json', scope: 'batch', fields: [{ name: 'people', type: 'strings' }], input: { previous: true, lines: false } } },
      ],
      edges: [
        { id: '1', source: 'entry', sourceHandle: 'out', target: 'find' },
        { id: '2', source: 'find', sourceHandle: 'out', target: 'ask' },
        { id: '3', source: 'find', sourceHandle: 'out', target: 'all' },
        { id: '4', source: 'all', sourceHandle: 'out', target: 'merge' },
      ],
    });
    const workflow = db.insert(s.workflows).values({ projectId, name: 'w', definition }).returning().get();
    for (const nodeId of ['ask', 'merge']) {
      const preview = previewRequest(db, workflow, nodeId, 'h1')!;
      expect(preview.unavailable).toContain('앞 노드의 결과');
      expect(preview.unavailable).toContain('실행 기록');
      expect(preview).toMatchObject({ system: '', prompt: '', promptTokens: 0, instructions: nodeId === 'ask' ? 'Use what was found.' : 'Merge.' });
    }
    expect(previewContext(db, projectId, 'h1', { workflowId: workflow.id, nodeId: 'ask' })).toMatchObject({ unavailable: expect.stringContaining('앞 노드의 결과') });
    // The first node reads only lines: it is shown.
    expect(previewRequest(db, workflow, 'find', 'h1')).toMatchObject({ unavailable: null, sample: { value: 'h1' } });
  });
});
