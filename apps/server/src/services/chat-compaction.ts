import type { UIMessage } from 'ai';
import { badRequest } from '../refusal.ts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { estimateTokens, limitsFor, runCardOf, runEndOf } from '@loca/shared';
import * as ai from '@loca/ai';
import type { Db } from '../db/index.ts';
import { perDatabase } from '../db/per-database.ts';
import * as s from '../db/schema.ts';
import { logged } from '../domain/ai-calls.ts';
import { capToolOutputs, isRunRecord, runCardLine, runEndLine, transcript } from './chat-record.ts';

/**
 * A conversation is sent whole until it would not fit the model's window; then, as pi does, the
 * start is compacted: the newest KEEP_RECENT_TOKENS stay as they are and everything before is
 * replaced by a summary the conversation's own model writes. The summary is stored on the chat
 * (`compaction`), so later turns reuse it and compact again only when the record outgrows the
 * window once more (the earlier summary is folded into the new one).
 */
/** Room left for the reply and what the turn adds before the next look. */
export const RESERVE_TOKENS = 16_384;
/** The newest part of the conversation kept as it is when the start is summarized. */
export const KEEP_RECENT_TOKENS = 20_000;
/** A model whose window neither the connection nor its model list gives. */
export const UNKNOWN_WINDOW = 128_000;

type Compaction = NonNullable<typeof s.chatSessions.$inferSelect.compaction>;

export const summaryText = (summary: string) => `이 대화의 앞부분 요약(길어져서 요약으로 대신함, 이어서 대화하세요):\n${summary}`;

/** The record as the model sees it: the stored summary in place of the messages it covers. */
export function withCompaction(record: UIMessage[], compaction: Compaction | null): UIMessage[] {
  // A summary that covers more than the record holds is stale (the record was cut back): the record stands.
  if (!compaction || compaction.upTo <= 0 || compaction.upTo > record.length) return record;
  return [{ id: 'compaction', role: 'user', parts: [{ type: 'text', text: summaryText(compaction.summary) }] }, ...record.slice(compaction.upTo)];
}

/** An attached image costs about what a provider charges for one, not the size of its base64 text. */
const IMAGE_TOKENS = 1_500;
/** A run card costs its line, not the scope ids it carries. */
const cardPart = (part: UIMessage['parts'][number]) => {
  const card = runCardOf({ parts: [part] });
  if (card) return { type: 'run-card', line: runCardLine(card) };
  const end = runEndOf({ parts: [part] });
  return end ? { type: 'run-end', line: runEndLine(end) } : part;
};
export const partsTokens = (parts: UIMessage['parts']) => estimateTokens(parts.map((part) => (part.type === 'file' ? { type: 'file' } : cardPart(part)))) + IMAGE_TOKENS * parts.filter((part) => part.type === 'file').length;

const tokensOf = (messages: UIMessage[]) => messages.reduce((sum, message) => sum + partsTokens(message.parts), 0);

/** The model's window from its model list; UNKNOWN_WINDOW when neither says. */
export function chatWindow(db: Db, connectionId: string | undefined, model: string) {
  const connection = connectionId ? db.select({ modelLimits: s.connections.modelLimits }).from(s.connections).where(eq(s.connections.id, connectionId)).get() : undefined;
  return limitsFor(connection, model)?.contextWindow ?? UNKNOWN_WINDOW;
}

/**
 * Where the kept part starts: walking back from the newest message until KEEP_RECENT_TOKENS are
 * kept, then back to a user message so a reply is never split from its question. 0 when nothing
 * before the kept part is left to summarize.
 */
export function cutPoint(record: UIMessage[], from: number) {
  let kept = 0;
  let cut = record.length;
  while (cut > from + 1 && kept < KEEP_RECENT_TOKENS) kept += partsTokens(record[--cut]!.parts);
  while (cut > from && record[cut]?.role !== 'user') cut--;
  return cut > from ? cut : 0;
}

const SUMMARY_SYSTEM = `당신은 번역 작업실 채팅의 앞부분을 요약합니다. 이 요약이 그 부분을 대신해 다음 대화의 문맥이 됩니다.
다음을 빠짐없이, 사실만 적으세요(한국어):
- 사용자가 원한 것과 정한 것(결정, 규칙, 선호)
- 한 일: 부른 도구와 결과의 요지, 만든 제안의 id와 수락·거절 여부, 바꾼 대상의 id와 이름
- 아직 남은 일과 열린 질문
- 이후에 다시 필요할 사실(대사·인물·용어 id, 수치, 인용할 원문)
이전 요약이 주어지면 그 내용도 새 요약에 합칩니다. 지어내지 마세요.`;

/**
 * Tool results as the other agents keep them (Codex's tool output limit, Gemini CLI's truncation before compressing,
 * Anthropic's clearing of old tool results): a result from an earlier turn goes to the model as its start and end, up
 * to EARLIER_TOOL_CHARS; the turn's own results stay whole. The summary reads the newest SUMMARY_RECENT results the same
 * way and older ones down to SUMMARY_OLD_TOOL_CHARS: what was called on what and how it ended, not the data it returned.
 * The person's messages are never cut.
 */
export const EARLIER_TOOL_CHARS = 8_000;
export const SUMMARY_RECENT = 5;
export const SUMMARY_OLD_TOOL_CHARS = 600;

/** The record with the results of turns before the current one (the last message the person sent) capped. */
export function capEarlierResults(record: UIMessage[]): UIMessage[] {
  const current = record.findLastIndex((message) => message.role === 'user' && !isRunRecord(message));
  if (current <= 0) return record;
  const earlier = record.slice(0, current);
  const capped = capToolOutputs(earlier, () => EARLIER_TOOL_CHARS);
  return capped === earlier ? record : [...capped, ...record.slice(current)];
}

/** One summary of `messages` (and the summary before them), in pieces when they do not fit the model at once. */
async function summarize(db: Db, chat: { id: string; projectId: string }, target: ai.ModelTarget, window: number, previous: string | null, messages: UIMessage[], signal?: AbortSignal): Promise<string> {
  const room = Math.max(8_000, window - RESERVE_TOKENS - estimateTokens(SUMMARY_SYSTEM) - 2_000);
  messages = capToolOutputs(messages, (rank) => (rank < SUMMARY_RECENT ? EARLIER_TOOL_CHARS : SUMMARY_OLD_TOOL_CHARS), { inputs: true });
  let summary = previous;
  let start = 0;
  while (start < messages.length) {
    // As many messages as fit beside the summary so far (at least one).
    let end = start;
    let used = summary ? estimateTokens(summary) : 0;
    while (end < messages.length && (end === start || used + partsTokens(messages[end]!.parts) <= room)) used += partsTokens(messages[end++]!.parts);
    const prompt = [summary ? `이전 요약:\n${summary}` : '', `요약할 대화:\n${transcript(messages.slice(start, end))}`].filter(Boolean).join('\n\n');
    const result = await logged(db, { projectId: chat.projectId, kind: 'chat', refId: chat.id, label: '대화 압축' }, target, () =>
      ai.generate(target, { system: SUMMARY_SYSTEM, prompt, schema: z.object({ summary: z.string().min(1) }), timeoutMs: 300_000, signal }),
    );
    summary = result.object.summary;
    start = end;
  }
  return summary ?? '';
}

/**
 * The record for this turn's model, compacted first when it would not fit: `overhead` is what the
 * turn adds around it (system prompt, tool schemas, a CLI's own prompt).
 */
export async function fitRecord(input: { db: Db; chat: typeof s.chatSessions.$inferSelect; target: ai.ModelTarget; record: UIMessage[]; overhead: number; signal?: AbortSignal }): Promise<UIMessage[]> {
  const { db, chat, target } = input;
  const record = capEarlierResults(input.record);
  const window = chatWindow(db, target.connectionId, target.model);
  const stored = chat.compaction && chat.compaction.upTo <= record.length ? chat.compaction : null;
  const current = withCompaction(record, stored);
  if (tokensOf(current) + input.overhead <= window - RESERVE_TOKENS) return current;
  const from = stored?.upTo ?? 0;
  const cut = cutPoint(record, from);
  // Only the newest exchange is left: nothing more to summarize; the model gets it as it is.
  if (!cut) return current;
  const summary = await summarize(db, chat, target, window, stored?.summary ?? null, record.slice(from, cut), input.signal);
  const compaction = { upTo: cut, summary, at: Date.now() };
  db.update(s.chatSessions).set({ compaction }).where(eq(s.chatSessions.id, chat.id)).run();
  return withCompaction(record, compaction);
}

/** Conversations being compacted on request (/compact), each with the work a new turn waits for. */
const compacting = perDatabase(() => new Map<string, Promise<unknown>>());

/** Resolves once no /compact of the conversation is running: a turn started meanwhile reads the summary it stored. */
export const compactionSettled = (db: Db, sessionId: string): Promise<void> => compacting(db).get(sessionId)?.then(() => undefined, () => undefined) ?? Promise.resolve();

/**
 * /compact: everything said so far becomes the summary now, whether or not it would still fit the
 * model, so the next turn starts from the summary alone. A CLI keeps the whole conversation in its
 * own session; that session is let go, and the next turn opens a new one with the summary.
 */
export function compactNow(input: { db: Db; sessionId: string; target: ai.ModelTarget; signal?: AbortSignal }): Promise<Compaction> {
  const { db, sessionId, target } = input;
  const running = compacting(db);
  if (running.has(sessionId)) badRequest('이 대화는 이미 압축하는 중입니다.');
  const work = (async () => {
    const chat = db.select().from(s.chatSessions).where(eq(s.chatSessions.id, sessionId)).get();
    if (!chat) badRequest('대화가 없습니다.');
    const record = chat.messages as UIMessage[];
    const stored = chat.compaction && chat.compaction.upTo <= record.length ? chat.compaction : null;
    const from = stored?.upTo ?? 0;
    if (record.length <= from) badRequest(record.length ? '마지막 압축 뒤로 나눈 대화가 없습니다.' : '압축할 대화가 없습니다.');
    const summary = await summarize(db, chat, target, chatWindow(db, target.connectionId, target.model), stored?.summary ?? null, record.slice(from), input.signal);
    // Messages that came in meanwhile (a run card) stay after the summary: it covers what was read above.
    const compaction = { upTo: record.length, summary, at: Date.now() };
    db.update(s.chatSessions).set({ compaction, agentSession: null }).where(eq(s.chatSessions.id, sessionId)).run();
    if (chat.agentSession) void ai.closeSession(chat.agentSession.id);
    return compaction;
  })();
  running.set(sessionId, work);
  return work.finally(() => running.delete(sessionId));
}
