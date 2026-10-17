import { consumeStream } from 'ai';
import { events } from '../events.ts';

/**
 * Chat turns in progress, by conversation. A turn belongs to the conversation, not to the request
 * that started it: a reload or a closed window does not cut it off (its reply is saved when it
 * ends), and the panel can still see it running and stop it. A server restart does end it; the
 * AI log records that as the call's failure.
 */
const turns = new Map<string, { controller: AbortController; startedAt: number; closing: boolean }>();

/**
 * Messages sent while a turn is running (#44), by conversation. The running turn hands them to its
 * model at the next step boundary (after a tool result, or when it would otherwise stop); what a
 * turn could not take (it stopped for a tool approval) waits for the next turn. Kept apart from the
 * turn so nothing is lost between two turns.
 */
const steers = new Map<string, string[]>();

export function startTurn(projectId: string, sessionId: string) {
  turns.get(sessionId)?.controller.abort();
  const controller = new AbortController();
  const turn = { controller, startedAt: Date.now(), closing: false };
  turns.set(sessionId, turn);
  events.changed(projectId, 'chat');
  return {
    signal: controller.signal,
    /**
     * Called by a backend right after its last look at the queue found it empty: from here on a
     * message sent is not taken by this turn, so the steer request is refused and the browser sends
     * it as a new message once the turn ends.
     */
    markClosing: () => {
      turn.closing = true;
    },
    end: () => {
      if (turns.get(sessionId)?.controller !== controller) return;
      turns.delete(sessionId);
      events.changed(projectId, 'chat');
    },
  };
}

/** True when a running turn can still take a message sent now. */
export const steerable = (sessionId: string) => {
  const turn = turns.get(sessionId);
  return Boolean(turn && !turn.closing && !turn.controller.signal.aborted);
};

export function enqueueSteer(sessionId: string, text: string) {
  steers.set(sessionId, [...(steers.get(sessionId) ?? []), text]);
}

/** The queued messages, removed from the queue (the caller hands them to the model). */
export function takeSteers(sessionId: string) {
  const queued = steers.get(sessionId) ?? [];
  steers.delete(sessionId);
  return queued;
}

export const hasSteers = (sessionId: string) => Boolean(steers.get(sessionId)?.length);

/** Stops the turn; messages it had not taken yet go back to the person (the input box). */
export function stopTurn(sessionId: string) {
  const turn = turns.get(sessionId);
  turn?.controller.abort();
  return { stopped: Boolean(turn), queued: takeSteers(sessionId) };
}

export const turnStartedAt = (sessionId: string) => turns.get(sessionId)?.startedAt ?? null;

/** How a steering message reads to the model, after the message it interrupts. */
export const steerPrompt = (texts: string[]) => (texts.length ? `사용자가 진행 중에 보낸 메시지(지금 하던 일보다 우선합니다):\n${texts.join('\n\n')}` : '');

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
