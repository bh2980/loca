import { consumeStream } from 'ai';
import { events } from '../events.ts';

/**
 * Chat turns in progress, by conversation. A turn belongs to the conversation, not to the request
 * that started it: a reload or a closed window does not cut it off (its reply is saved when it
 * ends), and the panel can still see it running and stop it. A server restart does end it; the
 * AI log records that as the call's failure.
 */
const turns = new Map<string, { controller: AbortController; startedAt: number }>();

export function startTurn(projectId: string, sessionId: string) {
  turns.get(sessionId)?.controller.abort();
  const controller = new AbortController();
  turns.set(sessionId, { controller, startedAt: Date.now() });
  events.changed(projectId, 'chat');
  return {
    signal: controller.signal,
    end: () => {
      if (turns.get(sessionId)?.controller !== controller) return;
      turns.delete(sessionId);
      events.changed(projectId, 'chat');
    },
  };
}

/** True when there was a turn to stop. */
export function stopTurn(sessionId: string) {
  const turn = turns.get(sessionId);
  turn?.controller.abort();
  return Boolean(turn);
}

export const turnStartedAt = (sessionId: string) => turns.get(sessionId)?.startedAt ?? null;

/**
 * Response options that read the reply to its end even when nobody is listening any more (the
 * stream's own save runs at its end), then mark the turn over.
 */
export const readToEnd = (end: () => void) => ({
  consumeSseStream: async ({ stream }: { stream: ReadableStream<string> }) => {
    try {
      await consumeStream({ stream });
    } finally {
      end();
    }
  },
});
