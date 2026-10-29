import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import { eq } from 'drizzle-orm';
import * as ai from '@tw/ai';
import type { Db } from '../db/index.ts';
import * as s from '../db/schema.ts';
import { learnImages, logged } from './ai-calls.ts';
import { acpImages } from './chat-images.ts';
import { imageDecision, IMAGE_UNSUPPORTED_NOTE } from '@tw/shared';
import { agentCatalog, jsonSchemaOf, type CatalogTool } from './agent-catalog.ts';
import { catchUp, handover, lastExchange, textOf, transcript, type AnsweredBy } from './chat-context.ts';
import { fitRecord } from './chat-compaction.ts';
import { estimateTokens } from '@tw/shared';
import { takeInterjections, writeInterjections } from './chat-interject.ts';
import { chatStream, runCatalogTool, turnPrompt } from './chat-stream.ts';
import type { ChatTurn } from './chat-turns.ts';

/**
 * Project chat through an agent CLI over ACP (packages/ai acp.ts). The CLI keeps the conversation
 * in its own session, reused while the connection kind and model stay the same; the server's
 * record stays the source of truth (a new session gets it as a handover). Workbench tools are the
 * same catalog the loca CLI uses, served to the session as an MCP server: reads run at once,
 * changes become proposals for this chat. The browser receives the AI SDK UI message stream like
 * any other chat, text as it streams.
 */
const RESULT_LIMIT = 20_000;
/** What a CLI adds to every request on its own (its system prompt and tools; Grok's is about 21k tokens). */
const CLI_OVERHEAD = 25_000;

/** The running turn of each chat: what its MCP tools write into and run as. */
interface LiveTurn {
  writer: UIMessageStreamWriter;
  tools: Map<string, CatalogTool>;
  model: string;
  /** Ends the reply's open text part before a tool call shows. */
  breakText: () => void;
  /**
   * A tool ran in the current step. What follows starts a new step: the panel sends a reply whose
   * last step ends in finished tool calls back on its own (API chat), so text must not share it.
   */
  toolRan: boolean;
}
const live = new Map<string, LiveTurn>();

/** Each chat's MCP server, for this server run (its token lives in the CLI's session; a reopened session gets the current one). */
const servers = new Map<string, ReturnType<typeof ai.hostTools>>();

export async function disposeChatServer(sessionId: string) {
  const pending = servers.get(sessionId);
  servers.delete(sessionId);
  const hosted = await pending?.catch(() => undefined);
  hosted?.dispose();
  live.delete(sessionId);
}

function chatServer(db: Db, chat: { id: string; projectId: string }): Promise<ai.HostedServer> {
  let server = servers.get(chat.id);
  if (!server) {
    server = ai
      .hostTools('loca', () => {
        const turn = live.get(chat.id);
        const tools = turn ? [...turn.tools.values()] : agentCatalog(db, chat.projectId);
        return tools.map((tool) => ({ name: tool.name, description: tool.changes ? `${tool.description}\n(변경: 이 대화의 제안으로 올라감)` : tool.description, inputSchema: jsonSchemaOf(tool.schema), run: (input) => runTool(db, chat, tool.name, input) }));
      });
    servers.set(chat.id, server);
  }
  return server.then((hosted) => hosted.server);
}

async function runTool(db: Db, chat: { id: string; projectId: string }, name: string, input: Record<string, unknown>) {
  const turn = live.get(chat.id);
  if (!turn) return { isError: true, text: '이 대화의 차례가 끝나 도구를 부를 수 없습니다.' };
  const tool = turn.tools.get(name);
  const toolCallId = crypto.randomUUID();
  turn.breakText();
  turn.toolRan = true;
  turn.writer.write({ type: 'tool-input-available', toolCallId, toolName: name, input });
  let text: string;
  let isError = false;
  try {
    if (!tool) throw new Error(`알 수 없는 도구입니다: ${name}`);
    // A change's input is checked here, so a malformed one fails like a read would.
    const result = await runCatalogTool(db, { ...chat, model: turn.model }, 'cli', tool, tool.changes ? (tool.schema.parse(input) as Record<string, unknown>) : input, RESULT_LIMIT);
    if (result.ok) {
      turn.writer.write({ type: 'tool-output-available', toolCallId, output: result.output });
      text = result.text;
    } else {
      // The panel shows the plain reason; the agent also gets the ids to fix it with.
      turn.writer.write({ type: 'tool-output-error', toolCallId, errorText: result.error });
      text = `제안을 만들지 않았습니다 — ${result.reason}`;
      isError = true;
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    turn.writer.write({ type: 'tool-output-error', toolCallId, errorText: message });
    text = `실패 — ${message}`;
    isError = true;
  }
  // A message sent while the agent works reaches it with the next tool result (#44).
  const items = takeInterjections(db, chat.id);
  if (items.length) text = `${text}\n\n${writeInterjections(turn.writer, items)}`;
  return { text, isError };
}

/** Where chat sessions run: an empty folder, the same for every chat (CLIs file sessions by folder). */
function chatFolder() {
  const dir = path.join(tmpdir(), 'loca-chat');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function cliChatResponse(input: {
  db: Db;
  chat: typeof s.chatSessions.$inferSelect;
  route: ai.ResolvedRoute;
  system: string;
  view: string | null;
  /** The conversation record with the new user message last (the server's, not the browser's). */
  messages: UIMessage[];
  answeredBy: AnsweredBy;
  /** A turn has no overall limit (tool calls can run long): it is stopped when the CLI reports nothing for this long. */
  idleMs: number;
  /** The conversation's running turn (chat-turns startTurn): its signal, end and closing mark. */
  turn: Pick<ChatTurn, 'signal' | 'end' | 'record' | 'markClosing'>;
}): Promise<Response> {
  const { db, chat, route, messages } = input;
  const kind = route.kind as ai.AcpKind;
  const tools = new Map(agentCatalog(db, chat.projectId, { model: route.model }).map((tool) => [tool.name, tool]));
  const saved = chat.agentSession && chat.agentSession.kind === route.kind && chat.agentSession.model === route.model ? chat.agentSession : null;
  // The new message is the newest that is not a run card (a regenerate can leave cards after it; they go with the message).
  const last = lastExchange(messages);
  const lastAt = last ? messages.lastIndexOf(last) : messages.length;
  const earlier = messages.slice(0, lastAt);
  const cardsAfter = transcript(messages.slice(lastAt + 1));
  // Messages and decisions that came in since the last turn come after the new message.
  const leftover = takeInterjections(db, chat.id);
  let sessionId: string | undefined;

  return chatStream({
    db,
    chat,
    messages,
    turn: input.turn,
    execute: async (writer) => {
      writer.write({ type: 'message-metadata', messageMetadata: { answeredBy: input.answeredBy } });
      writeInterjections(writer, leftover);
      const cwd = chatFolder();
      const server = await chatServer(db, chat);
      // The session: still open in a running process, reopened from the CLI's store, or new.
      let agent = saved ? await ai.agentWith(kind, route.executable, saved.id) : null;
      let lead: string | null = null;
      if (agent) sessionId = saved!.id;
      else {
        agent = await ai.agentFor(kind, route.executable);
        const reopened = saved ? await agent.reopen({ sessionId: saved.id, cwd, mcpServers: [server], system: input.system }) : null;
        if (reopened && saved) sessionId = saved.id;
        else {
          const created = await agent.newSession({ cwd, mcpServers: [server], system: input.system });
          sessionId = created.sessionId;
          if (created.inMessage) lead = input.system;
        }
      }
      if (input.turn.signal.aborted) {
        await ai.closeSession(sessionId);
        input.turn.signal.throwIfAborted();
      }
      await agent.use(sessionId, route.model, route.effort);
      // The CLI's session is told what it missed (another model answered in between); a new one gets the record.
      const known = sessionId === saved?.id;
      // A new session gets the whole record, its start summarized only when it would not fit the model.
      const context = known
        ? catchUp(earlier, saved?.seen ?? earlier.length)
        : handover((await fitRecord({ db, chat, route, record: messages, overhead: estimateTokens(input.system) + estimateTokens([...tools.values()].map((tool) => ({ name: tool.name, description: tool.description, input: jsonSchemaOf(tool.schema) }))) + CLI_OVERHEAD, signal: input.turn.signal })).filter((message) => message !== last));
      // Images go as prompt blocks when the agent says it takes them; the capability is kept so the composer can warn before sending.
      learnImages(db, route.connectionId, route.model, agent.takesImages());
      const wanted = acpImages(last);
      const decision = imageDecision(agent.takesImages(), wanted.length);
      const images = decision.send ? wanted : [];
      let prompt = [lead, turnPrompt({ context, view: input.view, text: [last ? textOf(last) : '', cardsAfter, decision.dropped ? `(이미지 ${decision.dropped}장은 ${IMAGE_UNSUPPORTED_NOTE}: 보내지 않았습니다)` : ''].filter(Boolean).join('\n'), leftover })].filter(Boolean).join('\n\n---\n\n');
      db.update(s.chatSessions).set({ agentSession: { kind: route.kind, model: route.model, id: sessionId, lastTurnAt: Date.now(), seen: known ? saved?.seen : 0 } }).where(eq(s.chatSessions.id, chat.id)).run();

      let textId: string | null = null;
      const breakText = () => {
        if (textId) writer.write({ type: 'text-end', id: textId });
        textId = null;
      };
      const current: LiveTurn = { writer, tools, model: route.model, breakText, toolRan: false };
      const newStep = () => {
        writer.write({ type: 'finish-step' });
        writer.write({ type: 'start-step' });
        current.toolRan = false;
      };
      live.set(chat.id, current);
      try {
        for (let pass = 0; ; pass++) {
          writer.write({ type: 'start-step' });
          await logged(db, { projectId: chat.projectId, kind: 'chat', refId: chat.id, label: `채팅 (CLI${pass ? ' · 끼어든 메시지 후' : ''})` }, route, () =>
            agent.prompt(
              sessionId!,
              prompt,
              {
                update: (update) => {
                  if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text') return;
                  if (!textId) {
                    if (current.toolRan) newStep();
                    textId = crypto.randomUUID();
                    writer.write({ type: 'text-start', id: textId });
                  }
                  writer.write({ type: 'text-delta', id: textId, delta: update.content.text });
                },
              },
              // Images go with the first request only; a message that came in meanwhile is text.
              { signal: input.turn.signal, idleMs: input.idleMs, ...(pass === 0 && images.length && { images }) },
            ),
          );
          breakText();
          if (current.toolRan) newStep();
          writer.write({ type: 'finish-step' });
          // A message sent after its last tool call: carry on with it instead of ending the turn (#44).
          const items = takeInterjections(db, chat.id);
          if (!items.length) {
            input.turn.markClosing();
            return;
          }
          prompt = writeInterjections(writer, items);
        }
      } finally {
        breakText();
        live.delete(chat.id);
      }
    },
    alsoSave: (final) => {
      // The CLI session has now seen the whole record, its own reply included.
      const agentSession = db.select({ agentSession: s.chatSessions.agentSession }).from(s.chatSessions).where(eq(s.chatSessions.id, chat.id)).get()?.agentSession;
      return agentSession && sessionId === agentSession.id ? { agentSession: { ...agentSession, seen: final.length } } : {};
    },
  });
}
