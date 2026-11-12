import { describe, expect, it } from 'vitest';
import { writeQueue } from './write-queue';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('writeQueue', () => {
  it('sends the second write to a row only after the first has its answer, with what that answer brought', async () => {
    const queue = writeQueue();
    // A fake server: each write must carry the rev the row has now, and moves it.
    let rev = 1;
    let known = 1;
    const first = deferred<void>();
    const sent: number[] = [];
    const write = (gate?: Promise<void>) => queue.run(['line-1'], async () => {
      const carried = known;
      sent.push(carried);
      await gate;
      if (carried !== rev) throw new Error('409');
      rev += 1;
      known = rev;
    });
    const memo = write(first.promise);
    const text = write();
    await tick();
    expect(sent).toEqual([1]);
    first.resolve();
    await Promise.all([memo, text]);
    expect(sent).toEqual([1, 2]);
    expect(rev).toBe(3);
  });

  it('does not make writes to different rows wait for each other', async () => {
    const queue = writeQueue();
    const slow = deferred<void>();
    const order: string[] = [];
    const a = queue.run(['a'], async () => { await slow.promise; order.push('a'); });
    const b = queue.run(['b'], async () => { order.push('b'); });
    await b;
    expect(order).toEqual(['b']);
    slow.resolve();
    await a;
    expect(order).toEqual(['b', 'a']);
  });

  it('a bulk write waits for every row it names, and the rows wait for it', async () => {
    const queue = writeQueue();
    const gates = { a: deferred<void>(), bulk: deferred<void>() };
    const order: string[] = [];
    const a = queue.run(['a'], async () => { await gates.a.promise; order.push('a'); });
    const bulk = queue.run(['a', 'b', 'c'], async () => { order.push('bulk starts'); await gates.bulk.promise; order.push('bulk'); });
    const c = queue.run(['c'], async () => { order.push('c'); });
    await tick();
    expect(order).toEqual([]);
    gates.a.resolve();
    await tick();
    expect(order).toEqual(['a', 'bulk starts']);
    gates.bulk.resolve();
    await Promise.all([a, bulk, c]);
    expect(order).toEqual(['a', 'bulk starts', 'bulk', 'c']);
  });

  it('a refused write rejects for its caller and lets the next one through', async () => {
    const queue = writeQueue();
    const failed = queue.run(['a'], async () => { throw new Error('refused'); });
    const next = queue.run(['a'], async () => 'saved');
    await expect(failed).rejects.toThrow('refused');
    await expect(next).resolves.toBe('saved');
  });

  it('idle resolves once what was queued for the rows is done', async () => {
    const queue = writeQueue();
    const gate = deferred<void>();
    let done = false;
    void queue.run(['a'], async () => { await gate.promise; done = true; });
    const idle = queue.idle(['a', 'z']).then(() => done);
    gate.resolve();
    expect(await idle).toBe(true);
    await expect(queue.idle(['a'])).resolves.toBeUndefined();
  });
});
