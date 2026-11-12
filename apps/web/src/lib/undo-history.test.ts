import { describe, expect, it } from 'vitest';
import { createdStep, tokenStep, undoHistory } from './undo-history';

/** A fake server: a list of things, edits that answer with a token, and undo by token. */
function fakeServer() {
  let things: string[] = [];
  let next = 0;
  const records = new Map<string, string[]>();
  const edit = (change: (now: string[]) => string[]) => async () => {
    const before = things;
    things = change(things);
    if (before.join() === things.join()) return { token: null };
    const token = `t${++next}`;
    records.set(token, before);
    return { token };
  };
  const takeBack = async (token: string) => {
    const before = records.get(token);
    if (!before) throw new Error('되돌릴 수 없습니다.');
    records.delete(token);
    things = before;
  };
  return { edit, takeBack, things: () => things };
}

describe('undoHistory', () => {
  it('undoes and redoes edits through their tokens, newest first', async () => {
    const server = fakeServer();
    const history = undoHistory();
    for (const name of ['a', 'b']) {
      const add = server.edit((now) => [...now, name]);
      history.record(tokenStep(await add(), add, server.takeBack)!);
    }
    expect(server.things()).toEqual(['a', 'b']);
    expect(await history.undo()).toBe(true);
    expect(server.things()).toEqual(['a']);
    expect(await history.undo()).toBe(true);
    expect(server.things()).toEqual([]);
    expect(await history.undo()).toBe(false);
    expect(await history.redo()).toBe(true);
    expect(server.things()).toEqual(['a']);
    // Done again, the edit has a new token: it can be undone again.
    expect(await history.undo()).toBe(true);
    expect(server.things()).toEqual([]);
  });

  it('an edit that changed nothing is no step', async () => {
    const server = fakeServer();
    const nothing = server.edit((now) => now);
    expect(tokenStep(await nothing(), nothing, server.takeBack)).toBeNull();
  });

  it('a new edit forgets what was undone', async () => {
    const history = undoHistory();
    const log: string[] = [];
    const step = (name: string) => ({ undo: async () => void log.push(`undo ${name}`), redo: async () => void log.push(`redo ${name}`) });
    history.record(step('a'));
    await history.undo();
    expect(history.canRedo()).toBe(true);
    history.record(step('b'));
    expect(history.canRedo()).toBe(false);
    expect(await history.redo()).toBe(false);
    expect(log).toEqual(['undo a']);
  });

  it('keeps at most `limit` steps, dropping the oldest', async () => {
    const history = undoHistory({ limit: 2 });
    const undone: number[] = [];
    for (const n of [1, 2, 3]) history.record({ undo: async () => void undone.push(n), redo: async () => undefined });
    while (await history.undo());
    expect(undone).toEqual([3, 2]);
  });

  it('a step that fails stays in place, so it can be tried again', async () => {
    const history = undoHistory();
    let fail = true;
    let undone = 0;
    history.record({ undo: async () => { if (fail) throw new Error('서버가 꺼져 있습니다'); undone++; }, redo: async () => undefined });
    await expect(history.undo()).rejects.toThrow('서버가 꺼져 있습니다');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    fail = false;
    expect(await history.undo()).toBe(true);
    expect(undone).toBe(1);
  });

  it('a step the server refuses for good is dropped, and the one before it is reached', async () => {
    const refused = new Error('그사이 바뀌어 되돌릴 수 없습니다.');
    const history = undoHistory({ gone: (error) => error === refused });
    const undone: string[] = [];
    history.record({ undo: async () => void undone.push('older'), redo: async () => undefined });
    history.record({ undo: async () => { throw refused; }, redo: async () => undefined });
    await expect(history.undo()).rejects.toBe(refused);
    expect(await history.undo()).toBe(true);
    expect(undone).toEqual(['older']);
  });

  it('something just made is deleted by undo and put back by redo with the delete\'s token', async () => {
    const server = fakeServer();
    await server.edit(() => ['made'])();
    const history = undoHistory();
    const remove = server.edit((now) => now.filter((name) => name !== 'made'));
    history.record(createdStep(async () => (await remove()).token, server.takeBack));
    await history.undo();
    expect(server.things()).toEqual([]);
    await history.redo();
    expect(server.things()).toEqual(['made']);
    await history.undo();
    expect(server.things()).toEqual([]);
  });
});
