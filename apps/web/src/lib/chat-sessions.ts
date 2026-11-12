import { queryOptions } from '@tanstack/react-query';
import { createOptimisticAction, useLiveQuery } from '@tanstack/react-db';
import type { InferRequestType } from 'hono/client';
import type { ChatChip, RunCard } from '@tw/shared';
import { client, unwrap } from './api';
import { liveRows, projectCollection, sent, type FeedRow } from './collections';
import { isCurrent, queryClient } from './query-client';
import { key } from './query-keys';

/**
 * A project's conversations. Their list (title, model, permission mode, model use) is a collection the row feed
 * keeps current. What one conversation holds (its messages, with its run cards) is a question under the chat topic:
 * the messages live in the conversation's row on the server and nowhere else in the browser, and a change to the
 * conversation (a reply saved, a run card made or answered, here or in another window) asks it again.
 */
export type ChatSessionRow = FeedRow['chatSessions'];
type ChatApi = (typeof client.chat)[':sessionId'];

export const chatSessionsCollection = (projectId: string) => projectCollection('chatSessions', projectId);

/** Conversations, last changed first. */
export function useChatSessions(projectId: string) {
  return liveRows(useLiveQuery((query) => query.from({ session: chatSessionsCollection(projectId) }).orderBy(({ session }) => session.updatedAt, 'desc')));
}

/** A conversation as the server saved it: messages, the turn going on, the meter's numbers, what waits to be sent. */
export const chatSession = (sessionId: string) =>
  queryOptions({ queryKey: key('chat', 'session', sessionId), queryFn: () => unwrap(client.chat[':sessionId'].$get({ param: { sessionId } })), staleTime: Infinity });

/** Conversations whose messages mention the words. */
export const chatSearch = (projectId: string, query: string) =>
  queryOptions({ queryKey: key('chat', 'search', projectId, query), queryFn: () => unwrap(client.projects[':projectId'].chat.search.$get({ param: { projectId }, query: { q: query } })) });

// ── writes ─────────────────────────────────────────────────────────────────────

/**
 * A new conversation (the server starts it with the AI the latest one picked). Done once the feed has brought it:
 * picked before it is listed, the list would unpick it.
 */
export const createChat = (projectId: string) => sent(projectId, client.projects[':projectId'].chat.$post({ param: { projectId }, json: {} }));
export const deleteChat = (projectId: string, sessionId: string) => sent(projectId, client.chat[':sessionId'].$delete({ param: { sessionId } }));

type ChatPatch = InferRequestType<ChatApi['$patch']>['json'];
/** What a conversation's row shows of each kind of change before the server echoes it. */
const shown = (json: ChatPatch): Partial<ChatSessionRow> => ({
  ...(json.title !== undefined && { title: json.title }),
  ...(json.permissionMode !== undefined && { permissionMode: json.permissionMode }),
  ...(json.model && { connectionId: json.model.connectionId, model: json.model.model, effort: json.model.effort ?? null }),
});

/** Changes a conversation's title, permission mode or model: shown at once, put back on failure, done once the feed brings it. */
export function changeChat(projectId: string, sessionId: string, json: ChatPatch) {
  const rows = chatSessionsCollection(projectId);
  const run = createOptimisticAction<void>({
    onMutate: () => {
      if (rows.has(sessionId)) rows.update(sessionId, (draft) => void Object.assign(draft, shown(json)));
    },
    mutationFn: async () => {
      await sent(projectId, client.chat[':sessionId'].$patch({ param: { sessionId }, json }));
    },
  });
  return run().when('settled');
}

/**
 * The turn of a conversation, which runs on the server: these act on it while it runs and change no row a screen
 * reads from a collection (what they leave in the conversation comes with its next read).
 */
export const chatTurn = (sessionId: string) => ({
  /** Stops the turn; answers with the messages it had not taken yet. */
  stop: () => unwrap(client.chat[':sessionId'].stop.$post({ param: { sessionId } })),
  /** Summarizes the conversation's start to make room. */
  compact: (signal: AbortSignal) => unwrap(client.chat[':sessionId'].compact.$post({ param: { sessionId } }, { init: { signal } })),
  /** A message for the running turn to take at its next step; false when the server did not take it. */
  steer: (text: string) => client.chat[':sessionId'].steer.$post({ param: { sessionId }, json: { text } }).then((response) => response.ok, () => false),
  /** Takes a waiting message back; `removed` false: the turn had already taken it. */
  unsteer: (text: string) => unwrap(client.chat[':sessionId'].unsteer.$post({ param: { sessionId }, json: { text } })).catch(() => ({ removed: false })),
});

/** The conversation with what was just written to it: its question is being asked again (the write's answer named the chat topic); that answer is waited for. */
const conversationRead = (sessionId: string) => {
  const options = chatSession(sessionId);
  // A read that fails does not undo the write: the card comes with the next read.
  return queryClient.fetchQuery({ ...options, staleTime: isCurrent(options.queryKey) ? Infinity : 0 }).catch(() => undefined);
};

/**
 * The chat's 실행 확인 card lives on the server, in the conversation: it is made from the picks, then answered once.
 * Either changes the conversation, so its question (chatSession) is asked again and the card shows from there; the
 * write is done once that answer is in, so the card on screen is never the one from before it.
 */
export async function makeRunCard(projectId: string, sessionId: string, workflowId: string, chips: ChatChip[]) {
  const card = (await sent(projectId, client.chat[':sessionId']['run-cards'].$post({ param: { sessionId }, json: { workflowId, chips } }))) as RunCard;
  await conversationRead(sessionId);
  return card;
}

export async function answerRunCard(projectId: string, sessionId: string, cardId: string, answer: 'start' | 'cancel') {
  const card = (await sent(projectId, client.chat[':sessionId']['run-cards'][':cardId'][answer].$post({ param: { sessionId, cardId } }))) as RunCard;
  await conversationRead(sessionId);
  return card;
}
