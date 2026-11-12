import { useCallback, useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * What the browser keeps for itself, in one place: every key is declared in STORED (its name, whether it lasts
 * for the tab or the browser, what its value looks like and what it is when nothing is kept), and is read and
 * written only through `stored` / `useStored`. `pnpm ui-rules` refuses localStorage and sessionStorage anywhere
 * else in the app. Page state a link should carry (filters, selection, tabs) is the URL's, never this.
 *
 * - `session`: this tab only (viewports, unsaved drafts, picks, what is folded): gone with the tab.
 * - `local`: this browser (preferences, layouts a person arranged): shared by its tabs, which hear a change.
 *
 * Values are JSON, read back through the key's schema: one that no longer fits (an older shape, a hand edit)
 * reads as the fallback. Storage can be off or full (private mode, a quota): a value that cannot be kept is
 * held in memory for the page's lifetime, so the screen that set it still works.
 */
export const PREFIX = 'loca.';
export type Scope = 'session' | 'local';

export interface StoredKey<T, Ids extends readonly string[] = []> {
  name: string;
  scope: Scope;
  schema: z.ZodType<T>;
  fallback: T;
  /** Type-only: what tells one value of this key from another (a project id, a run id…). */
  readonly ids?: Ids;
}

const define = <T, Ids extends readonly string[] = []>(name: string, scope: Scope, schema: z.ZodType<T>, fallback: T): StoredKey<T, Ids> => ({ name, scope, schema, fallback });

type Project = [projectId: string];
const point = z.object({ x: z.number(), y: z.number() });
const positions = z.record(z.string(), point);
const viewport = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() });
export type Viewport = z.infer<typeof viewport>;
const ids = z.array(z.string());

export const STORED = {
  // ── this browser: preferences ────────────────────────────────────────────────
  /** Light or dark; nothing kept follows the OS. index.html reads the same key before first paint. */
  theme: define<'light' | 'dark' | null>('theme', 'local', z.enum(['light', 'dark']).nullable(), null),
  chatOpen: define('chat.open', 'local', z.boolean(), false),
  /** The conversation this browser last had open in a project: where a new tab starts (lib/chat-dock.ts). */
  chatSessionLast: define<string | null, Project>('chat.session', 'local', z.string().nullable(), null),
  /** When this browser last saw a project's conversations (the unread dot). */
  chatSeen: define<number | null, Project>('chat.seen', 'local', z.number().nullable(), null),
  /** When 최근 실행 was last cleared in a project. */
  recentRunsCleared: define<number, Project>('runs.recent.cleared', 'local', z.number(), 0),
  /** What an export did with the lines it left out, the last time. */
  exportRest: define<'source' | 'omit', Project>('export.rest', 'local', z.enum(['source', 'omit']), 'source'),
  gettingStartedHidden: define<boolean, Project>('getting-started.hidden', 'local', z.boolean(), false),
  /** The workflow last run from a place (the place names the list it was started from). */
  runWorkflow: define<string | null, [projectId: string, place: string]>('run.workflow', 'local', z.string().nullable(), null),
  /** The line filters last used to start a workflow in a project. */
  runFilters: define<{ statuses?: string[]; marks?: string[]; tags?: string[]; facts?: string[] }, [projectId: string, workflowId: string]>('run.filters', 'local', z.object({ statuses: ids.optional(), marks: ids.optional(), tags: ids.optional(), facts: ids.optional() }), {}),
  graphShow: define<'both' | 'source' | 'translation'>('graph.show', 'local', z.enum(['both', 'source', 'translation']), 'both'),
  graphPaneView: define<'node' | 'flow'>('graph.pane', 'local', z.enum(['node', 'flow']), 'flow'),
  graphSpeakerWidth: define<number | null>('graph.speaker-width', 'local', z.number().positive().nullable(), null),
  graphMinimap: define('graph.minimap', 'local', z.boolean(), true),
  // ── this browser: layouts a person arranged ──────────────────────────────────
  /** Where a person dragged the nodes of a relationship graph (the graph names itself). */
  relationshipPositions: define<Record<string, { x: number; y: number }>, [graph: string]>('relationships.positions', 'local', positions, {}),
  /** The automatic layout of a relationship graph, kept so the same people open in the same places. */
  relationshipLayout: define<{ key: string; byId: Record<string, { x: number; y: number }> } | null, [graph: string]>('relationships.layout', 'local', z.object({ key: z.string(), byId: positions }).nullable(), null),
  /** Where a person dragged the events of the 사건 흐름, per direction it is drawn in. */
  eventFlowPositions: define<Record<string, { x: number; y: number }>, [projectId: string, direction: string]>('events.positions', 'local', positions, {}),
  /** Where this browser put a run's nodes, and the arranged lines between them (null after a drag: straight lines). */
  runGraphLayout: define<{ positions: Record<string, { x: number; y: number }>; routes: Record<string, unknown> | null } | null, [runId: string]>('run.layout', 'local', z.object({ positions, routes: z.record(z.string(), z.unknown()).nullable() }).nullable(), null),
  // ── this tab: where things were left ─────────────────────────────────────────
  /** An unsaved edit and what it was begun from (lib/drafts.ts: the one draft mechanism). */
  draft: define<{ text: string; base: string | null } | null, [key: string]>('draft', 'session', z.object({ text: z.string(), base: z.string().nullable() }).nullable(), null),
  /** The conversation this tab has open in a project (lib/chat-dock.ts). */
  chatSession: define<string | null, Project>('chat.session', 'session', z.string().nullable(), null),
  /** Rows picked by checkbox in a list (lib/use-picked.ts). */
  picked: define<string[], [list: string]>('picked', 'session', ids, []),
  /** The search a sidebar item was last left with, to come back to. */
  sidebarLast: define<{ pathname: string; search: Record<string, unknown> } | null, [projectId: string, item: string]>('sidebar.last', 'session', z.object({ pathname: z.string(), search: z.record(z.string(), z.unknown()) }).nullable(), null),
  scriptListOpen: define('script.list', 'session', z.boolean(), true),
  /** The sections unfolded in the script's group list (they start closed). */
  groupsExpanded: define<string[], Project>('script.expanded', 'session', ids, []),
  /** Open folds of a workflow's or a run's graph (components/workflow/fold.ts). */
  folds: define<{ open: string[] } | null, [graph: string]>('workflow.folds', 'session', z.object({ open: ids }).nullable(), null),
  workflowViewport: define<Viewport | null, [workflowId: string, direction: string]>('workflow.viewport', 'session', viewport.nullable(), null),
  runViewport: define<Viewport | null, [runId: string]>('run.viewport', 'session', viewport.nullable(), null),
  /** Where a graph canvas was left (the dialogue and scene graphs, a reading route's graph): the view names itself. */
  graphViewport: define<{ x: number; y: number; k: number } | null, [view: string]>('graph.viewport', 'session', z.object({ x: z.number().finite(), y: z.number().finite(), k: z.number().finite().positive() }).nullable(), null),
  /** How far the reading route's list was scrolled. */
  routeScroll: define<number, [route: string]>('route.scroll', 'session', z.number().nonnegative(), 0),
  /** The scene a reading route is asked to pass through. */
  routeVia: define<string, [route: string]>('route.via', 'session', z.string(), ''),
} as const;

// ── the stores ─────────────────────────────────────────────────────────────────

type Backend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const backend = (scope: Scope): Backend | undefined => {
  try {
    return (scope === 'local' ? globalThis.localStorage : globalThis.sessionStorage) as Backend | undefined;
  } catch {
    return undefined;
  }
};

/** What could not be kept (storage off or full), by full key: read back for the page's lifetime. */
const memory = new Map<string, string | null>();
const cache = new Map<string, { raw: string | null; value: unknown }>();
const listeners = new Map<string, Set<() => void>>();

const rawOf = (scope: Scope, full: string): string | null => {
  if (memory.has(full)) return memory.get(full) ?? null;
  try {
    return backend(scope)?.getItem(full) ?? null;
  } catch {
    return null;
  }
};

const parse = <T,>(key: StoredKey<T, readonly string[]>, raw: string | null): T => {
  if (raw === null) return key.fallback;
  try {
    const result = key.schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : key.fallback;
  } catch {
    return key.fallback;
  }
};

const notify = (full: string) => {
  for (const listener of listeners.get(full) ?? []) listener();
};

/** Another tab changed a `local` value: this tab's readers of it hear it. Listened for once, when something subscribes. */
let listening = false;
const listenToOtherTabs = () => {
  if (listening || typeof globalThis.addEventListener !== 'function') return;
  listening = true;
  globalThis.addEventListener('storage', (event) => {
    const changed = (event as StorageEvent).key;
    if (changed === null) for (const full of listeners.keys()) notify(full);
    else if (changed.startsWith(PREFIX)) notify(changed);
  });
};

export interface Slot<T> {
  /** The full storage key (`loca.<name>[.<id>…]`). */
  key: string;
  /** The value kept, or the key's fallback. The same object while what is kept does not change. */
  read: () => T;
  /** Keeps a value; the fallback (nothing to remember) removes it. */
  write: (value: T) => void;
  remove: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** One value of a key: `stored(STORED.chatSeen, projectId).read()`. */
export function stored<T, Ids extends readonly string[]>(key: StoredKey<T, Ids>, ...ids: Ids): Slot<T> {
  const full = `${PREFIX}${[key.name, ...ids].join('.')}`;
  const read = (): T => {
    const raw = rawOf(key.scope, full);
    const hit = cache.get(full);
    if (hit && hit.raw === raw) return hit.value as T;
    const value = parse(key, raw);
    cache.set(full, { raw, value });
    return value;
  };
  const put = (raw: string | null, value: T) => {
    try {
      const store = backend(key.scope);
      if (!store) throw new Error('no storage');
      if (raw === null) store.removeItem(full);
      else store.setItem(full, raw);
      memory.delete(full);
    } catch {
      memory.set(full, raw);
    }
    cache.set(full, { raw, value });
    notify(full);
  };
  const emptyRaw = JSON.stringify(key.fallback);
  return {
    key: full,
    read,
    write: (value) => {
      const raw = JSON.stringify(value);
      if (raw === emptyRaw) put(null, key.fallback);
      else put(raw, value);
    },
    remove: () => put(null, key.fallback),
    subscribe: (listener) => {
      listenToOtherTabs();
      const set = listeners.get(full) ?? new Set();
      set.add(listener);
      listeners.set(full, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(full);
      };
    },
  };
}

/** A stored value a component follows: every user of the same key draws again when it is written, here or in another tab. */
export function useStored<T, Ids extends readonly string[]>(key: StoredKey<T, Ids>, ...ids: Ids): [T, (next: T | ((now: T) => T)) => void] {
  const slot = stored(key, ...ids);
  const full = slot.key;
  // The slot is rebuilt each render; its full key says whether it is the same one.
  const subscribe = useCallback((listener: () => void) => stored(key, ...ids).subscribe(listener), [full]); // eslint-disable-line react-hooks/exhaustive-deps
  const value = useSyncExternalStore(subscribe, slot.read, () => key.fallback);
  const set = useCallback((next: T | ((now: T) => T)) => {
    const now = stored(key, ...ids);
    now.write(typeof next === 'function' ? (next as (now: T) => T)(now.read()) : next);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}

/** For tests: forgets what this page holds (the cache and the values storage refused). */
export function resetStoredForTest() {
  memory.clear();
  cache.clear();
  listeners.clear();
}
