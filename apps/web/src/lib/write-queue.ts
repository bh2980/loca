/**
 * Writes to the same row go to the server one after another: a write waits until every earlier write to any
 * of its rows has its answer, and only then reads what it sends (the row's rev, which the earlier answer
 * moved). Writes to different rows do not wait for each other. A failed write does not stop the ones behind it.
 */
export interface WriteQueue {
  /** Runs `task` once every earlier task that named one of `keys` has settled; resolves or rejects as the task does. */
  run: <T>(keys: Iterable<string>, task: () => Promise<T>) => Promise<T>;
  /** Resolves once nothing queued so far for `keys` is still running. */
  idle: (keys: Iterable<string>) => Promise<void>;
}

export function writeQueue(): WriteQueue {
  /** Each key's last queued task, settled or not: the next one for the key waits for it. */
  const tails = new Map<string, Promise<unknown>>();
  const waitFor = (keys: readonly string[]) => Promise.all(keys.flatMap((key) => (tails.has(key) ? [tails.get(key)!] : [])));
  return {
    run<T>(keys: Iterable<string>, task: () => Promise<T>): Promise<T> {
      const mine = [...new Set(keys)];
      const result = waitFor(mine).then(task);
      // What the next task waits for never rejects: a refusal is the caller's to hear, not the queue's.
      const tail: Promise<unknown> = result.then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        for (const key of mine) if (tails.get(key) === tail) tails.delete(key);
      });
      for (const key of mine) tails.set(key, tail);
      return result;
    },
    idle: (keys) => waitFor([...new Set(keys)]).then(() => undefined),
  };
}
