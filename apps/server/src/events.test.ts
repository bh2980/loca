import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withImplied, type ChangeEvent } from '@loca/shared';
import { openDatabase } from './db/index.ts';
import { Events, eventsOf, trackChanges } from './events.ts';

describe('Events coalescing', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function collect(bus: Events) {
    const got: ChangeEvent[] = [];
    bus.on('change', (e) => got.push(e));
    return got;
  }

  it('merges 50 calls within 100ms into one event with the union of topics', () => {
    const bus = new Events();
    const got = collect(bus);
    const topics = ['runs', 'calls', 'chat', 'graph'] as const;
    for (let i = 0; i < 50; i++) {
      bus.changed('p1', topics[i % 4]!);
      vi.advanceTimersByTime(2);
    }
    expect(got).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(1);
    expect(got[0]!.projectId).toBe('p1');
    expect([...got[0]!.topics].sort()).toEqual(['calls', 'chat', 'graph', 'runs', 'terms', 'units', 'workflows']);
  });

  it('keeps projects separate', () => {
    const bus = new Events();
    const got = collect(bus);
    bus.changed('a', 'runs');
    bus.changed('b', 'terms');
    bus.changed(undefined, 'connections');
    vi.advanceTimersByTime(300);
    expect(got).toHaveLength(3);
    expect(got.find((e) => e.projectId === 'a')!.topics).toEqual(['runs']);
    expect([...got.find((e) => e.projectId === 'b')!.topics].sort()).toEqual(['terms', 'units', 'workflows']);
  });

  it('emits at least every max wait under a steady stream', () => {
    const bus = new Events();
    const got = collect(bus);
    // A call every 100ms never leaves a 300ms quiet window.
    for (let t = 0; t < 3500; t += 100) {
      bus.changed('p1', 'runs');
      vi.advanceTimersByTime(100);
    }
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThanOrEqual(4);
  });

  it('flush() delivers synchronously', () => {
    const bus = new Events();
    const got = collect(bus);
    bus.changed('p1', 'runs');
    bus.flush();
    expect(got).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(got).toHaveLength(1);
  });
});

describe('implied topics', () => {
  it('refreshes queries that read beyond their own topic', () => {
    // A line change reaches term usage (terms) and an AI node's request preview (workflows).
    expect([...withImplied(['units'])].sort()).toEqual(['terms', 'units', 'workflows']);
    // A speech rule or character change reaches the line filter and hints (units) and, through lines, what reads them.
    expect([...withImplied(['knowledge'])].sort()).toEqual(['knowledge', 'terms', 'units', 'workflows']);
    // The reading route walks the graph (graph) and answers under units.
    expect([...withImplied(['graph'])].sort()).toEqual(['graph', 'terms', 'units', 'workflows']);
    // The line filter reads statuses and tags; the run preflight reads connections.
    expect([...withImplied(['statuses'])].sort()).toEqual(['statuses', 'terms', 'units', 'workflows']);
    expect([...withImplied(['connections'])].sort()).toEqual(['connections', 'terms', 'units', 'workflows']);
    expect([...withImplied(['calls'])].sort()).toEqual(['calls', 'runs']);
    // Nothing reads a conversation, a run or a proposal from under another topic.
    for (const topic of ['chat', 'runs', 'proposals', 'app'] as const) expect([...withImplied([topic])]).toEqual([topic]);
  });
});

/**
 * Where code may still say a topic itself: only for what is not a row. Every table's change is said by the
 * database (db/topics.ts), so an emit at a write site is refused here.
 */
const CHANGED_BY_HAND: Record<string, string> = {
  'db/index.ts': "topic_changed: the database's triggers saying a table's topic.",
  'services/chat-turn-registry.ts': 'A turn starting and ending: the turns being answered are held in memory, and GET /chat/:sessionId reads them.',
};

describe('emits at write sites', () => {
  it('are only the listed ones: a change that is not a row', () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sources = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(path.join(dir, entry.name)) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path.join(dir, entry.name)] : []));
    // Any spelling of the call: events.changed(, eventsOf(db).changed(, a bound alias of it.
    const emitting = sources(root).filter((file) => /\bevents(?:Of\([^)]*\))?\s*\.\s*changed\b/.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(root, file).split(path.sep).join('/'));
    expect(emitting.sort()).toEqual(Object.keys(CHANGED_BY_HAND).sort());
  });
});

describe('changes a request made', () => {
  it('are gathered with what they imply, so the response can name them', async () => {
    const own = new Events(0, 0);
    const { topics } = await trackChanges(async () => {
      await Promise.resolve();
      eventsOf(openDatabase(':memory:')).changed('p', 'terms');
      own.changed('p', 'chat');
    });
    expect([...topics].sort()).toEqual(['chat', 'terms', 'units', 'workflows']);
    // Outside a request nothing is gathered.
    expect(await trackChanges(async () => {})).toEqual({ topics: new Set(), seq: undefined });
  });
});

describe('the tab whose own requests made a change (#20)', () => {
  const capture = () => {
    const bus = new Events(10_000, 10_000);
    const seen: ChangeEvent[] = [];
    bus.on('change', (event) => seen.push(event));
    return { bus, seen };
  };

  it('is named when every change came from its running requests, so it can skip the event', async () => {
    const { bus, seen } = capture();
    await trackChanges(async () => bus.changed('p', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('p', 'terms'), 'tab-1');
    bus.flush();
    expect(seen).toEqual([expect.objectContaining({ projectId: 'p', origin: 'tab-1' })]);
  });

  it('is not named when another tab, a request without an id, or background work joined in', async () => {
    const { bus, seen } = capture();
    await trackChanges(async () => bus.changed('a', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('a', 'units'), 'tab-2');
    await trackChanges(async () => bus.changed('b', 'units'), 'tab-1');
    await trackChanges(async () => bus.changed('b', 'units'));
    await trackChanges(async () => bus.changed('c', 'units'), 'tab-1');
    bus.changed('c', 'runs');
    bus.flush();
    expect(seen.map((event) => [event.projectId, event.origin])).toEqual([['a', undefined], ['b', undefined], ['c', undefined]]);
  });

  it('is not named for work a request started that went on after its answer', async () => {
    const { bus, seen } = capture();
    // A timer started inside the request keeps its async context, as a run's progress does.
    let done: () => void = () => {};
    const finished = new Promise<void>((resolve) => (done = resolve));
    const { topics } = await trackChanges(async () => {
      setTimeout(() => (bus.changed('p', 'runs'), done()), 5);
    }, 'tab-1');
    await finished;
    bus.flush();
    expect(topics.size).toBe(0);
    expect(seen[0]?.origin).toBeUndefined();
  });
});
