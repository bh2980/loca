import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { q } from '@/lib/queries';

const key = (projectId: string) => `tw.chat.seen.${projectId}`;
const readSeen = (projectId: string) => {
  try {
    return Number(localStorage.getItem(key(projectId))) || null;
  } catch {
    return null;
  }
};
const writeSeen = (projectId: string, at: number) => {
  try {
    localStorage.setItem(key(projectId), String(at));
  } catch {
    /* private mode */
  }
};

/**
 * Whether a conversation changed while the chat panel was closed (a reply arrived, from this window
 * or one saved on the server after a reload). Everything is seen while the panel is open; the
 * first visit counts as seen, so old conversations never show as new.
 */
export function useChatUnread(projectId: string, open: boolean) {
  const sessions = useQuery(q.chatSessions(projectId));
  const [seen, setSeen] = useState(() => readSeen(projectId) ?? Date.now());
  const latest = Math.max(0, ...(sessions.data ?? []).map((session) => new Date(session.updatedAt).getTime()));

  useEffect(() => {
    if (!open) return;
    const now = Math.max(Date.now(), latest);
    setSeen(now);
    writeSeen(projectId, now);
  }, [open, latest, projectId]);

  return !open && latest > seen;
}
