import { Chat } from '@ai-sdk/react';
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
const chats = new Map<string, { chat: Chat<UIMessage>; view: { current: ChatView | null } }>();

export function chatFor(sessionId: string, saved: UIMessage[]) {
  const existing = chats.get(sessionId);
  if (existing) return existing;
  const view: { current: ChatView | null } = { current: null };
  const chat = new Chat<UIMessage>({
    id: sessionId,
    messages: saved,
    transport: new DefaultChatTransport({
      api: `/api/chat/${sessionId}/stream`,
      // The view is read at send time, so it describes what is on screen right now.
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages, view: view.current ?? undefined } }),
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
