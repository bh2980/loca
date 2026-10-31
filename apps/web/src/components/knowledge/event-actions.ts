import { unwrap } from '@/lib/api';
import { freeName, useGraphHistory } from './graph-history';

interface StoryEvent {
  id: string;
  title: string;
  summary: string;
  cause: string;
  outcome: string;
  participants: string[];
  evidence: string[];
}
/** A line of the 사건 흐름, by its two ends. */
export type FlowLine = { fromId: string; toId: string };
type PairLink = 'added' | 'hidden' | null;

/** A line's item key in the page's search (`item`), so a line opens in the pane like an event. */
export const lineKey = (line: FlowLine) => `line:${line.fromId}>${line.toId}`;
export const parseLineKey = (key: string | undefined): FlowLine | null => {
  const match = key?.match(/^line:(.+)>(.+)$/);
  return match ? { fromId: match[1]!, toId: match[2]! } : null;
};

/**
 * What the 사건 흐름 does, as the page's actions: draw a line from one event to another, delete
 * events and lines (a derived line is dropped for good, a drawn one removed), add an event, copy
 * events ("제목 (복사)"). Every one is a step ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay, the same keys as
 * the other graphs.
 */
export function useEventFlowActions({ projectId, events, open }: { projectId: string; events: StoryEvent[]; open: (item: string) => void }) {
  const { api, param, remove, restore, run, record, created, undo, redo } = useGraphHistory(projectId);
  const link = (line: FlowLine, action: 'link' | 'unlink') => unwrap(api['event-links'].$post({ param, json: { ...line, action } }));
  const setLink = (line: FlowLine, kind: PairLink) => unwrap(api['event-links'].$put({ param, json: { ...line, kind } }));
  /** Takes the lines away, then the events (whose own lines go with them); returns how to put it all back. */
  const removeAll = async (eventIds: string[], lines: FlowLine[]) => {
    const before: { line: FlowLine; kind: PairLink }[] = [];
    for (const line of lines) {
      const { previous, now } = await link(line, 'unlink');
      if (previous !== now) before.push({ line, kind: previous });
    }
    const token = eventIds.length ? await remove([{ kind: 'events', ids: eventIds }]) : null;
    return async () => {
      if (token) await restore(token);
      for (const { line, kind } of before.reverse()) await setLink(line, kind);
    };
  };

  return {
    /** Deletes events and lines at once. */
    remove: (target: { eventIds: string[]; lines: FlowLine[] }) =>
      run(async () => {
        if (!target.eventIds.length && !target.lines.length) return;
        let putBack = await removeAll(target.eventIds, target.lines);
        record({ undo: () => putBack(), redo: async () => (putBack = await removeAll(target.eventIds, target.lines)) });
      }),
    /** A line drawn from one event to another (or a dropped derived one brought back); the line opens. */
    connect: (fromId: string, toId: string) =>
      run(async () => {
        if (fromId === toId) return;
        const line = { fromId, toId };
        const { previous, now } = await link(line, 'link');
        if (previous !== now) record({ undo: () => setLink(line, previous), redo: () => setLink(line, now) });
        open(lineKey(line));
      }),
    /** 빈 곳 › 사건 추가: a new event; returns its id so the flow can put it where the menu opened. */
    addEvent: async () => {
      let id: string | undefined;
      await run(async () => {
        const row = await unwrap(api.events.$post({ param, json: { title: freeName('새 사건', new Set(events.map((event) => event.title.toLowerCase()))) } }));
        id = row.id;
        record(created([{ kind: 'events', ids: [row.id] }]));
        open(row.id);
      });
      return id;
    },
    /** Copies of events ("제목 (복사)", same evidence, so they sit where the originals do); returns old id → new id. */
    duplicate: async (ids: string[]) => {
      const made = new Map<string, string>();
      await run(async () => {
        const taken = new Set(events.map((event) => event.title.toLowerCase()));
        for (const original of events.filter((event) => ids.includes(event.id))) {
          const title = freeName(`${original.title} (복사)`, taken);
          taken.add(title.toLowerCase());
          const { summary, cause, outcome, participants, evidence } = original;
          const row = await unwrap(api.events.$post({ param, json: { title, summary, cause, outcome, participants, evidence } }));
          made.set(original.id, row.id);
        }
        if (made.size) record(created([{ kind: 'events', ids: [...made.values()] }]));
      });
      return made;
    },
    undo,
    redo,
  };
}

export type EventFlowActions = ReturnType<typeof useEventFlowActions>;
