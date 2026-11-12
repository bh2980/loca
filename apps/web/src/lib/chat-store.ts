import { Chat } from '@ai-sdk/react';
import { apiFetch } from './api';
import { isRunRecord } from '@loca/shared';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai';

/** What is on screen when a message is sent; the panel keeps it current while it is open. */
export interface ChatView {
  page: string;
  path: string;
  items: { kind: string; id: string; label: string; detail?: string; /** Added by the person with @, not read from the page. */ attached?: boolean }[];
}

/**
 * Conversations live here, outside the panel: closing the chat panel (or switching pages) must not
 * cut off a reply that is still coming in. A conversation is created once per session from what
 * the server saved, and keeps its messages, status and stream until the session is deleted.
 */
/** A session's chat, and what the next message says is on screen (read when it is sent; set with setView). */
const chats = new Map<string, { chat: Chat<UIMessage>; setView: (view: ChatView | null) => void }>();

export function chatFor(sessionId: string, saved: UIMessage[]) {
  const existing = chats.get(sessionId);
  if (existing) return existing;
  const view: { current: ChatView | null } = { current: null };
  const chat = new Chat<UIMessage>({
    id: sessionId,
    messages: saved,
    // What a turn changes it changes after the request was answered (the stream), so the server reports it as events
    // to every tab, this one included (events.ts: only a change made before the answer is skipped by its own tab).
    transport: new DefaultChatTransport({
      api: `/api/chat/${sessionId}/stream`,
      fetch: apiFetch,
      // The server owns the conversation (#46): only the newest message goes (run cards, kept by the server, are not messages to send) (a reply with the
      // result of a tool the browser carried out goes again, by id). The view is read at send time.
      prepareSendMessagesRequest: ({ messages, trigger }) => ({ body: { message: messages.findLast((message) => !isRunRecord(message)), trigger, view: view.current ?? undefined } }),
      // A turn this window did not start (a reload, another window, the server carrying on after
      // proposals were decided) is attached to from its start.
      prepareReconnectToStreamRequest: () => ({ api: `/api/chat/${sessionId}/stream` }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const entry = { chat, setView: (next: ChatView | null) => void (view.current = next) };
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
