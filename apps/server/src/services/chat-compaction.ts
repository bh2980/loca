import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { estimateTokens, limitsFor } from '@tw/shared';
import * as ai from '@tw/ai';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import { logged } from './ai-calls.ts';
import { transcript } from './chat-context.ts';

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
  if (!compaction || compaction.upTo <= 0 || compaction.upTo >= record.length) return record;
  return [{ id: 'compaction', role: 'user', parts: [{ type: 'text', text: summaryText(compaction.summary) }] }, ...record.slice(compaction.upTo)];
}

const tokensOf = (messages: UIMessage[]) => messages.reduce((sum, message) => sum + estimateTokens(message.parts), 0);

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
  while (cut > from + 1 && kept < KEEP_RECENT_TOKENS) kept += estimateTokens(record[--cut]!.parts);
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

/** One summary of `messages` (and the summary before them), in pieces when they do not fit the model at once. */
async function summarize(db: Db, chat: { id: string; projectId: string }, route: ai.ResolvedRoute, window: number, previous: string | null, messages: UIMessage[], signal?: AbortSignal): Promise<string> {
  const room = Math.max(8_000, window - RESERVE_TOKENS - estimateTokens(SUMMARY_SYSTEM) - 2_000);
  let summary = previous;
  let start = 0;
  while (start < messages.length) {
    // As many messages as fit beside the summary so far (at least one).
    let end = start;
    let used = summary ? estimateTokens(summary) : 0;
    while (end < messages.length && (end === start || used + estimateTokens(messages[end]!.parts) <= room)) used += estimateTokens(messages[end++]!.parts);
    const prompt = [summary ? `이전 요약:\n${summary}` : '', `요약할 대화:\n${transcript(messages.slice(start, end))}`].filter(Boolean).join('\n\n');
    const result = await logged(db, { projectId: chat.projectId, kind: 'chat', refId: chat.id, label: '대화 압축' }, route, () =>
      ai.generate(route, { system: SUMMARY_SYSTEM, prompt, schema: z.object({ summary: z.string().min(1) }), timeoutMs: 300_000, signal }),
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
export async function fitRecord(input: { db: Db; chat: typeof s.chatSessions.$inferSelect; route: ai.ResolvedRoute; record: UIMessage[]; overhead: number; signal?: AbortSignal }): Promise<UIMessage[]> {
  const { db, chat, route, record } = input;
  const window = chatWindow(db, route.connectionId, route.model);
  const stored = chat.compaction && chat.compaction.upTo < record.length ? chat.compaction : null;
  const current = withCompaction(record, stored);
  if (tokensOf(current) + input.overhead <= window - RESERVE_TOKENS) return current;
  const from = stored?.upTo ?? 0;
  const cut = cutPoint(record, from);
  // Only the newest exchange is left: nothing more to summarize; the model gets it as it is.
  if (!cut) return current;
  const summary = await summarize(db, chat, route, window, stored?.summary ?? null, record.slice(from, cut), input.signal);
  const compaction = { upTo: cut, summary, at: Date.now() };
  db.update(s.chatSessions).set({ compaction }).where(eq(s.chatSessions.id, chat.id)).run();
  events.changed(chat.projectId, 'chat');
  return withCompaction(record, compaction);
}
