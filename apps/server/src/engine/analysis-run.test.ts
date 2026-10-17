import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ModelError } from '@tw/ai';
import { ANALYSIS_WORKFLOW, analysisTemplate, importFileSchema } from '@tw/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import type { Analysis } from '../services/analysis.ts';
import { listAnalyses, startAnalysis } from '../services/analysis-runs.ts';
import { importProject } from '../services/importer.ts';
import { snapshotWorkflowModels } from '../services/routes.ts';
import { memoryStore } from '../services/secrets.ts';
import { agentCatalog } from '../services/agent-catalog.ts';
import { createRun, createRunInSteps, Runner, sceneHalf, type ModelPort } from './runner.ts';

/** Two scenes, three lines, a labelled branch: the work-analysis tests' script. */
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

const draft = (level: Analysis['speechRules'][number]['level']): Analysis => ({
  overview: { setting: '항구', mainConflict: '', plot: '앨리스가 늦은 밥을 꾸짖는다.', evidence: ['L1'] },
  characters: [
    { name: 'Alice', aliases: [], profile: '선장', speech: '짧고 단호함', player: false, gender: 'female', ageBand: 'middle', evidence: ['L1'] },
    { name: 'Bob', aliases: [], profile: '선원', speech: '', player: true, gender: 'male', ageBand: 'unknown', evidence: ['L2'] },
  ],
  relationships: [{ from: 'Bob', to: 'Alice', kind: '부하', description: '', changes: [], evidence: ['L2'] }],
  events: [{ title: '지각', summary: '', cause: '', outcome: '', participants: ['Bob'], evidence: ['L1', 'L99'] }],
  speechRules: [{ from: 'Bob', to: 'Alice', level, address: '선장님', note: '', start: null, evidence: ['L2'] }],
  terms: [{ source: 'boss', kind: 'title', meaning: '선원들이 선장을 부르는 말', target: '선장님', evidence: ['L2'] }],
  sceneListeners: [],
});

type Request = Parameters<ModelPort['generate']>[1];
const port = (answer: (request: Request) => unknown): ModelPort => ({
  judge: async () => {
    throw new Error('unused');
  },
  generate: async (_route, request) => ({ object: answer(request), usage: { inputTokens: 10, outputTokens: 5 } }) as never,
});

const rows = <T extends typeof s.speechRules | typeof s.characters | typeof s.storyEvents | typeof s.terms | typeof s.documents>(db: ReturnType<typeof openDatabase>, table: T, projectId: string) => db.select().from(table).where(eq(table.projectId, projectId)).all();

describe('work analysis as a workflow (#47)', () => {
  it('reads the whole script in one request and stores drafts with line keys; a rerun replaces only what nobody touched', async () => {
    const { db, projectId, choice } = setup();
    let level: Analysis['speechRules'][number]['level'] = 'hasipsio';
    const requests: Request[] = [];
    const runner = new Runner(db, memoryStore(), port((request) => (requests.push(request), draft(level))));

    const first = await startAnalysis(db, memoryStore(), projectId, choice);
    await runner.drain();
    // One request with every line as script text, every section asked for, the long timeout.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.prompt).toContain('## Ch 1 — Harbor [g1]\n  L1 Alice: You\'re late.\n  L2 Bob: Sorry, boss.\n\n## Ch 1 — Deck [g2]\n  L3 Alice: Never again.');
    expect(requests[0]!.prompt).toMatch(/^Return only JSON with "overview", "characters", "relationships", "events", "speechRules", "sceneListeners", "terms"\./);
    expect(requests[0]!.timeoutMs).toBeGreaterThanOrEqual(30 * 60_000);

    const [job] = listAnalyses(db, projectId);
    expect(job).toMatchObject({ id: first.runId, runId: first.runId, status: 'completed', partsDone: 1, partsTotal: 1, model: 'm' });
    expect(job!.result).toMatchObject({ characters: 2, speechRules: 1, events: 1, terms: 1, invalidEvidence: 1 });
    const rule = rows(db, s.speechRules, projectId)[0]!;
    expect(rule).toMatchObject({ fromName: 'Bob', level: 'hasipsio', evidence: ['a2'], origin: 'ai', statusBy: 'ai', jobId: first.runId });
    expect(rows(db, s.storyEvents, projectId)[0]!.evidence).toEqual(['a1']);
    // The AI log files analysis reads as such (their pace is not a translation run's).
    expect(db.select({ kind: s.aiCalls.kind }).from(s.aiCalls).where(eq(s.aiCalls.refId, first.runId)).all().map((call) => call.kind)).toEqual(['analysis']);

    // A person keeps one event; the rerun replaces the rest and does not propose the kept one again.
    db.update(s.storyEvents).set({ statusBy: 'human' }).run();
    level = 'haeyo';
    const second = await startAnalysis(db, memoryStore(), projectId, choice);
    await runner.drain();
    expect(rows(db, s.speechRules, projectId).map((r) => [r.level, r.jobId])).toEqual([['haeyo', second.runId]]);
    expect(rows(db, s.storyEvents, projectId).map((e) => e.jobId)).toEqual([first.runId]);
    expect(rows(db, s.characters, projectId)).toHaveLength(2);
    expect(rows(db, s.terms, projectId).filter((t) => t.source === 'boss')).toHaveLength(1);
    // The button made the workflow once, and new projects have it already.
    expect(db.select().from(s.workflows).where(eq(s.workflows.projectId, projectId)).all().filter((w) => w.name === ANALYSIS_WORKFLOW)).toHaveLength(1);
  });

  it('asks only for the sections a workflow picks and stores only those', async () => {
    const { db, projectId, choice } = setup();
    const requests: Request[] = [];
    const runner = new Runner(db, memoryStore(), port((request) => (requests.push(request), draft('hae'))));
    const workflow = db.insert(s.workflows).values({ projectId, name: '인물만', definition: analysisTemplate({ model: choice, sections: ['characters'] }) }).returning().get();
    createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {} });
    await runner.drain();
    expect(requests[0]!.prompt).toMatch(/^Return only JSON with "characters"\./);
    expect(requests[0]!.system).not.toContain('speechRules:');
    expect(Object.keys((requests[0]!.schema as unknown as { shape: object }).shape)).toEqual(['characters']);
    // The model answered more than asked: only people are stored.
    expect(rows(db, s.characters, projectId)).toHaveLength(2);
    expect(rows(db, s.speechRules, projectId)).toHaveLength(0);
    expect(rows(db, s.terms, projectId).filter((t) => t.origin === 'ai')).toHaveLength(0);
    expect(rows(db, s.documents, projectId).filter((d) => d.origin === 'ai')).toHaveLength(0);
  });

  it('adds without replacing when it read only some scenes', async () => {
    const { db, projectId, choice } = setup();
    const runner = new Runner(db, memoryStore(), port(() => draft('hae')));
    await startAnalysis(db, memoryStore(), projectId, choice);
    await runner.drain();
    const workflow = db.select().from(s.workflows).where(eq(s.workflows.name, ANALYSIS_WORKFLOW)).get()!;
    const g2 = db.select().from(s.groups).where(eq(s.groups.key, 'g2')).get()!;
    const partial = createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: { groupIds: [g2.id] } });
    await runner.drain();
    // The first run's events stay; the scene run only adds what is new (nothing here).
    expect(rows(db, s.storyEvents, projectId).map((e) => e.jobId)).not.toContain(partial.runId);
    expect(rows(db, s.storyEvents, projectId)).toHaveLength(1);
  });

  it('reads a request the model refuses as too long again in halves, cut between scenes', async () => {
    const { db, projectId, choice } = setup();
    const prompts: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      ...port(() => draft('hae')),
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('too-long', 'prompt is too long', false);
        return { object: draft('hae'), usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    await startAnalysis(db, memoryStore(), projectId, choice);
    await runner.drain();
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('[g1]');
    expect(prompts[1]).not.toContain('[g2]');
    expect(listAnalyses(db, projectId)[0]).toMatchObject({ status: 'completed' });
    // The halves found the same people: stored once.
    expect(rows(db, s.characters, projectId)).toHaveLength(2);
  });

  it('splits an answer cut off at the output limit like one that is too long', async () => {
    const { db, projectId, choice } = setup();
    const prompts: string[] = [];
    const runner = new Runner(db, memoryStore(), {
      ...port(() => draft('hae')),
      generate: async (_route, request) => {
        prompts.push(request.prompt);
        if ((request.prompt.match(/^## /gm) ?? []).length > 1) throw new ModelError('cli', 'CLI가 실패를 반환했습니다: Your previous response was cut off because it exceeded the output token limit', false);
        return { object: draft('hae'), usage: { inputTokens: 1, outputTokens: 1 } } as never;
      },
    });
    await startAnalysis(db, memoryStore(), projectId, choice);
    await runner.drain();
    expect(prompts).toHaveLength(3);
    expect(listAnalyses(db, projectId)[0]).toMatchObject({ status: 'completed' });
  });

  it('reports a failure without touching knowledge, and refuses a second analysis while one runs', async () => {
    const { db, projectId, choice } = setup();
    const runner = new Runner(db, memoryStore(), {
      ...port(() => null),
      generate: async () => {
        throw new Error('boom');
      },
    });
    await startAnalysis(db, memoryStore(), projectId, choice);
    await expect(startAnalysis(db, memoryStore(), projectId, choice)).rejects.toThrow('이미 진행 중');
    // The same guard holds for the agent's start_run and any other analysis workflow.
    const other = db.insert(s.workflows).values({ projectId, name: '인물만', definition: analysisTemplate({ model: choice, sections: ['characters'] }) }).returning().get();
    const start = agentCatalog(db, projectId).find((tool) => tool.name === 'start_run')!;
    expect(await start.run({ workflowId: other.id })).toMatchObject({ ok: false, error: expect.stringContaining('이미 진행 중') });
    await expect(createRunInSteps(db, { projectId, workflow: other, models: snapshotWorkflowModels(db, other.definition), scope: {} })).rejects.toThrow('이미 진행 중');
    await runner.drain();
    const [job] = listAnalyses(db, projectId);
    expect(job).toMatchObject({ status: 'failed', error: expect.stringContaining('boom') });
    expect(rows(db, s.speechRules, projectId)).toEqual([]);
  });

  it('cuts between scenes near the middle', () => {
    expect(sceneHalf(['a', 'a', 'b', 'c', 'c', 'c'])).toBe(3);
    expect(sceneHalf(['a', 'a', 'a', 'a', 'b'])).toBe(4);
    expect(sceneHalf(['a', 'a', 'a'])).toBe(2);
  });
});
