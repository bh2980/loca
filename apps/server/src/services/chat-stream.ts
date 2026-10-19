import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage, type UIMessageStreamWriter } from 'ai';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { events } from '../events.ts';
import type { CatalogTool } from './agent-catalog.ts';
import { proposeChange } from './change-gate.ts';
import { interjectionPrompt, type Interjection } from './chat-interject.ts';
import { markStopped, readToEnd, type ChatTurn } from './chat-turns.ts';
import { refusalText } from './proposal-check.ts';
import { fitText } from './tool-output.ts';

/**
 * What the chat backends (API, CLI; #49) share around their own model loop: the UI
 * message stream the panel reads, saving the record when the reply ends (a stopped turn marked as
 * such), and telling the panel the chat changed.
 */
export function chatStream(input: {
  db: Db;
  chat: { id: string; projectId: string };
  messages: UIMessage[];
  turn: Pick<ChatTurn, 'signal' | 'end' | 'record'>;
  execute: (writer: UIMessageStreamWriter) => Promise<void>;
  /** More to save with the record (the CLI's session bookkeeping); called once the reply is final. */
  alsoSave?: (final: UIMessage[]) => Partial<typeof s.chatSessions.$inferInsert>;
}): Response {
  const { db, chat, turn } = input;
  const stream = createUIMessageStream({
    originalMessages: input.messages,
    generateId: () => crypto.randomUUID(),
    execute: ({ writer }) => input.execute(writer),
    onFinish: ({ messages: final }) => {
      db.update(s.chatSessions).set({ messages: markStopped(final, turn.signal), ...input.alsoSave?.(final) }).where(eq(s.chatSessions.id, chat.id)).run();
      events.changed(chat.projectId, 'chat');
    },
    onError: errorText,
  });
  return createUIMessageStreamResponse({ stream, ...readToEnd(turn) });
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One whole text part (a reply that does not stream token by token). */
export function writeText(writer: UIMessageStreamWriter, text: string) {
  const id = crypto.randomUUID();
  writer.write({ type: 'text-start', id });
  writer.write({ type: 'text-delta', id, delta: text });
  writer.write({ type: 'text-end', id });
}

/** A turn's prompt for a backend that keeps its own session: what it missed, the open view, the new message, then anything queued. */
export function turnPrompt(parts: { context?: string | null; view: string | null; text: string; leftover: Interjection[] }) {
  return [parts.context, parts.view, parts.text, interjectionPrompt(parts.leftover)].filter(Boolean).join('\n\n');
}

export type CatalogToolResult =
  /** output for the panel, text for the agent. */
  | { ok: true; output: unknown; text: string }
  /** A change that did not become a proposal: the plain reason for the panel (error), the reason with ids to fix it for the agent. */
  | { ok: false; error: string; reason: string };

/**
 * A catalog tool called by a CLI agent: reads run at once, changes become proposals for this
 * chat (change-gate). A read that throws throws; each backend reports it its own way.
 */
export async function runCatalogTool(db: Db, chat: { id: string; projectId: string; model?: string | null }, source: 'cli', tool: CatalogTool, input: Record<string, unknown>, resultLimit?: number): Promise<CatalogToolResult> {
  if (tool.changes) {
    const gate = await proposeChange(db, { projectId: chat.projectId, sessionId: chat.id, model: chat.model, source, tool: tool.name, input });
    if (!gate.ok) return { ok: false, error: `제안하지 못했습니다: ${gate.error}`, reason: refusalText(gate) };
    return { ok: true, output: { proposalId: gate.proposalId, applied: gate.applied }, text: gate.text };
  }
  const output = await tool.run(input);
  return { ok: true, output, text: fitText(output, resultLimit) };
}
