import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as ai from '@loca/ai';
import { importFileSchema, isRunRecord, runEndOf } from '@loca/shared';
import { openDatabase } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { promptEntries } from './prompts.ts';
import { createRun } from './run-create.ts';
import { Runner, type ModelPort } from './runner.ts';
import { translateOnlyWorkflow } from './test-workflows.ts';
import { expandRecord, lastExchange, transcript, withStoredCards } from '../services/chat-record.ts';
import { partsTokens } from '../services/chat-compaction.ts';
import { continueAfterDecisions } from '../services/chat-turn.ts';
import { turnStartedAt } from '../services/chat-turn-registry.ts';
import { importProject } from '../services/importer.ts';
import { decideProposal, hasDecisionsToAnswer, hasUnreportedDecisions, propose, takeDecisions } from '../services/proposals.ts';
import { snapshotWorkflowModels } from '../domain/model-target.ts';
import { memoryStore } from '../domain/secrets.ts';

function setup() {
  const db = openDatabase(':memory:');
  const connection = db.insert(s.connections).values({ kind: 'openai', name: 'fake', baseUrl: 'http://localhost:1/v1' }).returning().get();
  db.update(s.connections).set({ modelLimits: { m: { maxOutput: 1000, by: 'api' } } }).where(eq(s.connections.id, connection.id)).run();
  const choice = { connectionId: connection.id, model: 'm' };
  const { projectId } = importProject(db, importFileSchema.parse({ format: 'loca/v1', project: { name: 'T' }, groups: [{ key: 'g', title: 'G' }], units: [{ key: 'a', group: 'g', source: 'one' }, { key: 'b', group: 'g', source: 'two' }, { key: 'c', group: 'g', source: 'three' }] }), choice);
  db.update(s.connections).set({ projectId }).where(eq(s.connections.id, connection.id)).run();
  const chat = db.insert(s.chatSessions).values({ projectId, title: 't', ...choice }).returning().get();
  const workflow = translateOnlyWorkflow(db, projectId);
  const start = (sessionId: string | null = chat.id) => createRun(db, { projectId, workflow, models: snapshotWorkflowModels(db, workflow.definition), scope: {}, sessionId }).runId;
  const messages = () => db.select().from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()!.messages as UIMessage[];
  return { db, projectId, chat, workflow, start, messages };
}

function model(fail: () => Error | null = () => null): ModelPort {
  return {
    ask: async () => {
      throw new Error('unused');
    },
    generate: async (_target, request) => {
      const error = fail();
      if (error) throw error;
      const lines = promptEntries(request.prompt) as { id: string; source: string }[];
      return { object: { results: lines.map((line) => ({ id: line.id, text: `[ko] ${line.source}` })) }, usage: { inputTokens: 10, outputTokens: 5 } } as never;
    },
  };
}

describe("a run's end in the conversation that started it", () => {
  it('records the end once and starts nothing: no turn runs because of it', async () => {
    const { db, chat, start, messages } = setup();
    const runId = start();
    await new Runner(db, memoryStore(), model()).drain();
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
    const records = messages().filter(isRunRecord);
    expect(records).toHaveLength(1);
    expect(runEndOf(records[0]!)).toMatchObject({ runId, status: 'completed', workflowName: '번역', total: 3, states: { done: 3 } });
    expect(turnStartedAt(db, chat.id)).toBeNull();
  });

  it('a run started elsewhere (the run dialog, the terminal) tells no conversation', async () => {
    const { db, start, messages } = setup();
    start(null);
    await new Runner(db, memoryStore(), model()).drain();
    expect(messages()).toEqual([]);
  });

  it('a conversation deleted meanwhile is no reason to fail the run', async () => {
    const { db, chat, start } = setup();
    const runId = start();
    db.delete(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).run();
    await new Runner(db, memoryStore(), model()).drain();
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.status).toBe('completed');
  });

  it('says why when the run paused by itself', async () => {
    const { db, start, messages } = setup();
    start();
    await new Runner(db, memoryStore(), model(() => new ai.ModelError('auth', '인증에 실패했습니다.', false))).drain();
    const end = runEndOf(messages().find(isRunRecord)!);
    expect(end?.status).toBe('paused');
    expect(end?.notice).toContain('인증');
  });

  it('a cancel records the end; cancelling what is already over does not record another', async () => {
    const { db, start, messages } = setup();
    const runId = start();
    const runner = new Runner(db, memoryStore(), model());
    runner.cancel(runId);
    expect(runEndOf(messages().find(isRunRecord)!)).toMatchObject({ status: 'cancelled', states: { cancelled: 3 } });
    runner.cancel(runId);
    expect(messages().filter(isRunRecord)).toHaveLength(1);
  });

  it('the agent reads it as one line, and it is never the exchange', () => {
    const end: UIMessage = { id: 'e1', role: 'user', metadata: { kind: 'run-end' }, parts: [{ type: 'data-run-end', data: { id: 'e1', runId: 'run-1', workflowName: '번역', subject: 'lines', status: 'completed', total: 12, states: { done: 10, failed: 2 }, notice: null, at: 1 } } as never] };
    const question: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: '돌려 줘' }] };
    const line = "이 대화에서 시작한 워크플로 실행 '번역'이 끝남 · run run-1 · 전체 12줄 (완료 10줄, 실패 2줄)";
    expect(expandRecord([question, end])[1]!.parts).toEqual([{ type: 'text', text: line }]);
    expect(transcript([question, end])).toBe(`사용자: 돌려 줘\n[${line}]`);
    expect(lastExchange([question, end])).toBe(question);
    // A reply saved after the run ended keeps the record it did not know.
    expect(withStoredCards([question], [question, end]).map((message) => message.id)).toEqual(['u1', 'e1']);
    expect(partsTokens(end.parts)).toBeLessThan(60);
  });
});

describe('starting a run from a conversation', () => {
  it('a person accepting start_run starts the run, no turn beside it, and the run belongs to the conversation', async () => {
    const { db, projectId, chat, workflow, messages } = setup();
    const proposal = propose(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id } });
    const row = await decideProposal(db, proposal.id, true);
    expect(row.status).toBe('accepted');
    const run = db.select().from(s.runs).get()!;
    expect(run.sessionId).toBe(chat.id);
    expect(row.result).toMatchObject({ note: expect.stringContaining('따로') });
    expect(hasDecisionsToAnswer(db, chat.id)).toBe(false);
    continueAfterDecisions({ db, secrets: memoryStore() }, chat.id);
    expect(turnStartedAt(db, chat.id)).toBeNull();
    expect(messages()).toEqual([]);
    // Told with the next message instead.
    expect(hasUnreportedDecisions(db, chat.id)).toBe(true);
    expect(takeDecisions(db, chat.id)).toContain('start_run');
  });

  it('a refused run is still answered, as is any other decision next to an accepted one', async () => {
    const { db, projectId, chat, workflow } = setup();
    const refused = propose(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id } });
    await decideProposal(db, refused.id, false);
    expect(hasDecisionsToAnswer(db, chat.id)).toBe(true);
    takeDecisions(db, chat.id);
    const accepted = propose(db, { projectId, sessionId: chat.id, source: 'api', tool: 'start_run', input: { workflowId: workflow.id } });
    await decideProposal(db, accepted.id, true);
    expect(hasDecisionsToAnswer(db, chat.id)).toBe(false);
    const other = propose(db, { projectId, sessionId: chat.id, source: 'api', tool: 'save_character', input: { name: 'Bob' } });
    await decideProposal(db, other.id, true);
    expect(hasDecisionsToAnswer(db, chat.id)).toBe(true);
  });

  it('a person going on with a run from the conversation makes its end told there', async () => {
    const { db, projectId, chat, start } = setup();
    const runId = start(null);
    const runner = new Runner(db, memoryStore(), model(() => new ai.ModelError('auth', '인증에 실패했습니다.', false)));
    await runner.drain();
    const proposal = propose(db, { projectId, sessionId: chat.id, source: 'api', tool: 'continue_run', input: { runId } });
    expect((await decideProposal(db, proposal.id, true)).status).toBe('accepted');
    expect(db.select().from(s.runs).where(eq(s.runs.id, runId)).get()!.sessionId).toBe(chat.id);
  });
});
