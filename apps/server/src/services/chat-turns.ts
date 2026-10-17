import { consumeStream, type UIMessage } from 'ai';
import { events } from '../events.ts';

/**
 * Chat turns in progress, by conversation. A turn belongs to the conversation, not to the request
 * that started it: a reload or a closed window does not cut it off (its reply is saved when it
 * ends), and the panel can still see it running and stop it. A server restart does end it; the
 * AI log records that as the call's failure.
 */
interface Turn {
  controller: AbortController;
  startedAt: number;
  closing: boolean;
  /** The reply's stream so far (SSE text), so a reloaded or second window can attach to it. */
  chunks: string[];
  listeners: Set<(chunk: string | null) => void>;
  /** Run once the turn has ended (e.g. a decision that came in too late for it starts the next). */
  after: (() => void)[];
}
const turns = new Map<string, Turn>();


export function startTurn(projectId: string, sessionId: string) {
  turns.get(sessionId)?.controller.abort();
  const controller = new AbortController();
  const turn: Turn = { controller, startedAt: Date.now(), closing: false, chunks: [], listeners: new Set(), after: [] };
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
    /** A piece of the reply's stream, kept for windows that attach later. */
    record: (chunk: string) => {
      turn.chunks.push(chunk);
      for (const listener of turn.listeners) listener(chunk);
    },
    end: () => {
      for (const listener of turn.listeners) listener(null);
      turn.listeners.clear();
      if (turns.get(sessionId)?.controller !== controller) return;
      turns.delete(sessionId);
      events.changed(projectId, 'chat');
      for (const run of turn.after) run();
    },
  };
}

export type ChatTurn = ReturnType<typeof startTurn>;

/** Runs `fn` when the conversation's running turn ends; at once when none is running. */
export function afterTurn(sessionId: string, fn: () => void) {
  const turn = turns.get(sessionId);
  if (turn) turn.after.push(fn);
  else fn();
}

/**
 * The running turn's reply as a stream from its start: what was sent so far, then the rest as it
 * comes (#43: a turn the server started, or one sent before a reload). Null when none is running.
 */
export function attachTurn(sessionId: string): ReadableStream<string> | null {
  const turn = turns.get(sessionId);
  if (!turn) return null;
  let listener: ((chunk: string | null) => void) | undefined;
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of turn.chunks) controller.enqueue(chunk);
      listener = (chunk) => {
        if (chunk === null) controller.close();
        else controller.enqueue(chunk);
      };
      turn.listeners.add(listener);
    },
    cancel() {
      if (listener) turn.listeners.delete(listener);
    },
  });
}

/** True when a running turn can still take a message sent now. */
export const steerable = (sessionId: string) => {
  const turn = turns.get(sessionId);
  return Boolean(turn && !turn.closing && !turn.controller.signal.aborted);
};

/** Stops the turn. Messages it had not taken yet go back to the person: see chat-interject.ts stopWithQueued. */
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
export const readToEnd = (turn: Pick<ChatTurn, 'end' | 'record'>) => ({
  consumeSseStream: async ({ stream }: { stream: ReadableStream<string> }) => {
    try {
      await consumeStream({ stream: stream.pipeThrough(new TransformStream<string, string>({ transform: (chunk, controller) => {
        turn.record(chunk);
        controller.enqueue(chunk);
      } })) });
    } finally {
      turn.end();
    }
  },
});

/**
 * A turn the person stopped is saved with `stopped` on its last message (the reply so far, or their
 * own message when nothing came back yet), so the panel can say '중지됨' there, also after a reload.
 */
export function markStopped(messages: UIMessage[], signal: AbortSignal): UIMessage[] {
  const last = messages.at(-1);
  if (!signal.aborted || !last) return messages;
  return [...messages.slice(0, -1), { ...last, metadata: { ...((last.metadata as object | undefined) ?? {}), stopped: true } }];
}
