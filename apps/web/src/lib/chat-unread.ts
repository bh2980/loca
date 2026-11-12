import { useEffect, useState } from 'react';
import { useChatSessions } from './chat-sessions';
import { stored, STORED } from './storage';

/**
 * Whether a conversation changed while the chat panel was closed (a reply arrived, from this window
 * or one saved on the server after a reload). Everything is seen while the panel is open; the
 * first visit counts as seen, so old conversations never show as new.
 */
export function useChatUnread(projectId: string, open: boolean) {
  const sessions = useChatSessions(projectId);
  const [seen, setSeen] = useState(() => stored(STORED.chatSeen, projectId).read() ?? Date.now());
  const latest = Math.max(0, ...(sessions.data ?? []).map((session) => new Date(session.updatedAt).getTime()));

  useEffect(() => {
    if (!open) return;
    const now = Math.max(Date.now(), latest);
    setSeen(now);
    stored(STORED.chatSeen, projectId).write(now);
  }, [open, latest, projectId]);

  return !open && latest > seen;
}
