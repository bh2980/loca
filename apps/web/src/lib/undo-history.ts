/**
 * The undo history of a screen whose edits the server can take back: each edit is a step with both
 * directions, ⌘/Ctrl+Z undoes the last one and ⌘/Ctrl+Shift+Z does it again. Both directions go through the
 * server (an edit answers with the token of its undo record, lib/undo.ts), so this holds no rows, only how to
 * replay. A new edit forgets what was undone; the oldest steps fall off past `limit`.
 *
 * A step that fails stays where it was (still the next to undo, or to do again), so the keys can be tried
 * again once the cause is gone, unless `gone` says the failure is for good (the server refused: what the step
 * would take back has changed since): then the step is dropped, so the ones before it can still be reached.
 * Either way the failure is the caller's to show.
 */
export interface UndoStep {
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

export interface UndoHistory {
  record: (step: UndoStep) => void;
  /** Undoes the last step; false when there is none. */
  undo: () => Promise<boolean>;
  /** Does the last undone step again; false when there is none. */
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function undoHistory({ limit = 100, gone = () => false }: { limit?: number; gone?: (error: unknown) => boolean } = {}): UndoHistory {
  const past: UndoStep[] = [];
  let future: UndoStep[] = [];
  const drop = (list: UndoStep[], step: UndoStep) => {
    // Taken off by identity: another edit may have been recorded while the server answered.
    const at = list.lastIndexOf(step);
    if (at >= 0) list.splice(at, 1);
  };
  return {
    record(step) {
      past.push(step);
      if (past.length > limit) past.shift();
      future = [];
    },
    async undo() {
      const step = past.at(-1);
      if (!step) return false;
      try {
        await step.undo();
      } catch (error) {
        if (gone(error)) drop(past, step);
        throw error;
      }
      drop(past, step);
      future.push(step);
      return true;
    },
    async redo() {
      const step = future.at(-1);
      if (!step) return false;
      try {
        await step.redo();
      } catch (error) {
        if (gone(error)) drop(future, step);
        throw error;
      }
      drop(future, step);
      past.push(step);
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}

/**
 * A step for an edit the server answered with an undo token: undo takes it back by the token, redo does the
 * edit again and keeps its new token. `token` null: the edit changed nothing, and there is no step.
 */
export function tokenStep<T extends { token: string | null }>(first: T, again: () => Promise<T>, takeBack: (token: string) => Promise<unknown>): UndoStep | null {
  let token = first.token;
  if (!token) return null;
  return {
    undo: async () => {
      if (token) await takeBack(token);
    },
    redo: async () => {
      token = (await again()).token;
    },
  };
}

/**
 * A step for something just made: undo deletes it (the delete answers with a token), redo puts it back by
 * that token.
 */
export function createdStep(remove: () => Promise<string | null>, restore: (token: string) => Promise<unknown>): UndoStep {
  let token: string | null = null;
  return {
    undo: async () => {
      token = await remove();
    },
    redo: async () => {
      if (token) await restore(token);
    },
  };
}

/**
 * The undo history of a screen whose edits are its own unsaved state (the workflow editor's draft): no server keeps
 * them, so a step is the content before and after. The screen says what the content is after every change (`seen`);
 * changes that follow one another within `pause` are one step (a drag, typing in a field), so undo goes back to
 * before the burst. Undo and redo put a snapshot back through `apply`; the content that comes back from it is taken
 * as it is, not as a new edit (it may be the same content written another way). The steps, their order and the
 * limit are `undoHistory`'s, the same as every other screen's.
 */
interface SnapshotHistory<T> {
  seen: (snapshot: T) => void;
  /** False when there is nothing to undo. The snapshot is put back at once; the promise is `undoHistory`'s. */
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function snapshotHistory<T>({ apply, pause = 400, limit = 100, now = Date.now }: { apply: (snapshot: T) => void; pause?: number; limit?: number; now?: () => number }): SnapshotHistory<T> {
  const history = undoHistory({ limit });
  let last: { snapshot: T } | undefined;
  let replaying = false;
  let at = 0;
  /** The step still taking changes (the burst going on). */
  let open: { before: T; after: T } | undefined;
  const replay = (snapshot: T) => {
    replaying = true;
    // What follows a replay is a step of its own, however soon it comes.
    at = 0;
    open = undefined;
    apply(snapshot);
  };
  return {
    seen(snapshot) {
      if (last && snapshot === last.snapshot) return;
      if (!last || replaying) {
        replaying = false;
        last = { snapshot };
        return;
      }
      const time = now();
      if (time - at > pause || !open) {
        const step = { before: last.snapshot, after: snapshot };
        open = step;
        history.record({ undo: async () => replay(step.before), redo: async () => replay(step.after) });
      } else open.after = snapshot;
      at = time;
      last = { snapshot };
    },
    undo: history.undo,
    redo: history.redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}
