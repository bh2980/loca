import { Chat } from '@ai-sdk/react';
import { apiFetch, notifyChanged } from './api';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';

/** What is on screen when a message is sent; the panel keeps it current while it is open. */
export interface ChatView {
  page: string;
  path: string;
  items: { kind: string; id: string; label: string; detail?: string }[];
}

/**
 * Conversations live here, outside the panel: closing the chat panel (or switching pages) must not
 * cut off a reply that is still coming in. A conversation is created once per session from what
 * the server saved, and keeps its messages, status and stream until the session is deleted.
 */
/** Every topic: an approved chat tool can write almost anywhere (statuses, runs, graph views…), so a finished turn refetches them all rather than keep a list in step with the tools. */
const CHAT_TOPICS = ['projects', 'units', 'graph', 'statuses', 'terms', 'knowledge', 'workflows', 'runs', 'chat', 'proposals', 'calls'];

const chats = new Map<string, { chat: Chat<UIMessage>; view: { current: ChatView | null } }>();

export function chatFor(sessionId: string, saved: UIMessage[]) {
  const existing = chats.get(sessionId);
  if (existing) return existing;
  const view: { current: ChatView | null } = { current: null };
  const chat = new Chat<UIMessage>({
    id: sessionId,
    messages: saved,
    // A streamed answer cannot carry x-changed, so what a turn changed is refetched when it ends.
    onFinish: () => notifyChanged(CHAT_TOPICS),
    transport: new DefaultChatTransport({
      api: `/api/chat/${sessionId}/stream`,
      fetch: apiFetch,
      // The server owns the conversation (#46): only the newest message goes (a reply whose tool
      // approval was just answered goes again, by id). The view is read at send time.
      prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { message: messages.at(-1), trigger, view: view.current ?? undefined } }),
      // A turn this window did not start (a reload, another window, the server carrying on after
      // proposals were decided) is attached to from its start.
      prepareReconnectToStreamRequest: () => ({ api: `/api/chat/${sessionId}/stream` }),
    }),
    sendAutomaticallyWhen: (options) => lastAssistantMessageIsCompleteWithApprovalResponses(options) || lastAssistantMessageIsCompleteWithToolCalls(options),
  });
  const entry = { chat, view };
  chats.set(sessionId, entry);
  return entry;
}

/** A deleted session: stop whatever it is doing and forget it. */
export function dropChat(sessionId: string) {
  const entry = chats.get(sessionId);
  if (!entry) return;
  void entry.chat.stop();
  chats.delete(sessionId);
}
