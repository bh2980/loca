import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A fake server and a fake held collection: lines with a rev that every write moves, a save that refuses a stale
 * rev (409), and a row feed the test delivers by hand (`deliver`), so the browser's rows can lag behind the answers.
 */
const server = vi.hoisted(() => {
  const lines = new Map<string, { rev: number; note: string; translation: string | null; statusId: string }>();
  const held = new Map<string, { id: string; updatedAt: string; tagIds: string[]; note: string; translation: string | null; statusId: string }>();
  const log: string[] = [];
  let clock = 1_000;
  const gates: (() => void)[] = [];
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, clone() { return this; }, headers: { get: () => null } });
  const touch = (id: string) => (lines.get(id)!.rev = ++clock);
  const row = (id: string) => ({ id, updatedAt: new Date(lines.get(id)!.rev).toISOString(), tagIds: [], note: lines.get(id)!.note, translation: lines.get(id)!.translation, statusId: lines.get(id)!.statusId });
  return {
    lines, held, log, gates,
    reset() {
      lines.clear(); held.clear(); log.length = 0; gates.length = 0; clock = 1_000;
      for (const id of ['a', 'b', 'c']) { lines.set(id, { rev: clock, note: '', translation: null, statusId: 'new' }); held.set(id, row(id)); }
    },
    /** The row feed brings these lines' rows to the browser. */
    deliver(ids: string[]) { for (const id of ids) held.set(id, row(id)); },
    /** The next request waits until the test lets it through. */
    hold() { return new Promise<void>((resolve) => gates.push(resolve)); },
    patch: async (id: string, json: { note?: string }, wait?: Promise<void>) => {
      log.push(`patch ${id}`);
      await wait;
      if (json.note !== undefined) lines.get(id)!.note = json.note;
      return answer(200, { ok: true, rev: touch(id) });
    },
    save: async (id: string, json: { text?: string; rev?: number }) => {
      log.push(`save ${id} rev=${json.rev}`);
      if (json.rev !== undefined && json.rev !== lines.get(id)!.rev) return answer(409, { error: '읽은 뒤에 다른 곳에서 바뀐 줄입니다.' });
      lines.get(id)!.translation = json.text ?? null;
      return answer(200, { ok: true, rev: touch(id) });
    },
    bulk: async (json: { unitIds: string[]; statusId?: string; revs?: Record<string, number> }, wait?: Promise<void>) => {
      log.push(`bulk ${json.statusId} revs=${json.revs ? json.unitIds.map((id) => json.revs![id]).join(',') : '-'}`);
      await wait;
      const stale = json.unitIds.filter((id) => json.revs && json.revs[id] !== undefined && json.revs[id] !== lines.get(id)!.rev);
      for (const id of json.unitIds) if (!stale.includes(id)) { lines.get(id)!.statusId = json.statusId!; touch(id); }
      return answer(200, { ok: true, changed: json.unitIds.length - stale.length, skipped: stale.length });
    },
  };
});
let nextWait: Promise<void> | undefined;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock('./api', () => ({
  client: {
    units: { ':unitId': {
      $patch: ({ param, json }: { param: { unitId: string }; json: { note?: string } }) => { const wait = nextWait; nextWait = undefined; return server.patch(param.unitId, json, wait); },
      save: { $post: ({ param, json }: { param: { unitId: string }; json: { text?: string; rev?: number } }) => server.save(param.unitId, json) },
    } },
    projects: { ':projectId': { units: { $patch: ({ json }: { json: { unitIds: string[]; statusId?: string; revs?: Record<string, number> } }) => { const wait = nextWait; nextWait = undefined; return server.bulk(json, wait); } } } },
  },
}));
vi.mock('./collections', () => ({
  // A write's answer; the wait for the row feed is the test's to play (server.deliver).
  sent: async (_scope: string, request: Promise<{ ok: boolean; json: () => Promise<{ error?: string }> }>) => {
    const response = await request;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body;
  },
}));
vi.mock('./units', () => ({
  unitsOf: () => ({
    collection: { has: (id: string) => server.held.has(id), get: (id: string) => server.held.get(id), update: (id: string, change: (draft: object) => void) => change(server.held.get(id)!) },
    idle: async () => undefined,
  }),
  extrasOf: () => ({ idle: async () => undefined }),
}));
vi.mock('./line-picks', () => ({ pickedNow: async () => ({ asOf: 0 }) }));
vi.mock('@tanstack/react-db', () => ({
  createOptimisticAction: ({ onMutate, mutationFn }: { onMutate: () => void; mutationFn: () => Promise<void> }) => () => {
    onMutate();
    const done = mutationFn();
    return { when: () => done };
  },
}));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => undefined }));

// A fresh module per test: what it remembers of answers and what waits in its queue are the test's own.
let { lineRev, patchLine, patchPickedLines, saveLine } = {} as typeof import('./line-writes');
beforeEach(async () => {
  server.reset();
  nextWait = undefined;
  vi.resetModules();
  ({ lineRev, patchLine, patchPickedLines, saveLine } = await import('./line-writes'));
});

describe('writes to one line', () => {
  it('memo then text, back to back: the save waits for the memo and carries the rev its answer brought', async () => {
    const gate = server.hold();
    nextWait = gate;
    const memo = patchLine('p', 'a', { note: '확인 필요' });
    const text = saveLine('p', { unitId: 'a', text: '번역' });
    await tick();
    // Only the memo is out; the save has not been sent with the rev from before it.
    expect(server.log).toEqual(['patch a']);
    server.gates[0]!();
    await Promise.all([memo, text]);
    // The feed never brought the row (the browser still holds rev 1000): the answer's rev is what the save carried.
    expect(server.log).toEqual(['patch a', 'save a rev=1001']);
    expect(server.lines.get('a')).toMatchObject({ note: '확인 필요', translation: '번역' });
    expect(server.held.get('a')!.updatedAt).toBe(new Date(1_000).toISOString());
  });

  it('uses the held row again once the feed has brought a newer one (a change from elsewhere)', async () => {
    await patchLine('p', 'a', { note: '메모' });
    expect(lineRev('p', 'a')).toBe(1_001);
    // A run changes the line; the feed brings its row.
    server.lines.get('a')!.rev = 5_000;
    server.deliver(['a']);
    expect(lineRev('p', 'a')).toBe(5_000);
    await saveLine('p', { unitId: 'a', text: '번역' });
    expect(server.log.at(-1)).toBe('save a rev=5000');
  });

  it('a save made from a view the line has moved past is refused, and the next write still goes', async () => {
    server.lines.get('a')!.rev = 7_000;
    await expect(saveLine('p', { unitId: 'a', text: '낡은 화면의 번역' })).rejects.toThrow('읽은 뒤에');
    server.deliver(['a']);
    await saveLine('p', { unitId: 'a', text: '번역' });
    expect(server.lines.get('a')!.translation).toBe('번역');
  });

  it('writes to different lines do not wait for each other', async () => {
    nextWait = server.hold();
    const slow = patchLine('p', 'a', { note: '느린 메모' });
    await saveLine('p', { unitId: 'b', text: '번역' });
    expect(server.log).toEqual(['patch a', 'save b rev=1000']);
    server.gates[0]!();
    await slow;
  });
});

describe('bulk changes to picked lines', () => {
  it('a second bulk change waits for the first and sends the revs the lines have after it', async () => {
    nextWait = server.hold();
    const first = patchPickedLines('p', ['a', 'b'], { statusId: 'review' });
    const second = patchPickedLines('p', ['a', 'b'], { statusId: 'done' });
    await tick();
    expect(server.log).toEqual(['bulk review revs=1000,1000']);
    // The first is answered and the feed brings the changed rows before the second is sent.
    server.gates[0]!();
    await first;
    server.deliver(['a', 'b']);
    expect(await second).toEqual({ ok: true, changed: 2, skipped: 0 });
    expect(server.log[1]).toBe('bulk done revs=1001,1002');
    expect(server.lines.get('a')!.statusId).toBe('done');
  });

  it('a line\'s own write and a bulk change that includes it go one after the other', async () => {
    nextWait = server.hold();
    const memo = patchLine('p', 'c', { note: '메모' });
    const bulk = patchPickedLines('p', ['b', 'c'], { statusId: 'review' });
    await tick();
    expect(server.log).toEqual(['patch c']);
    server.gates[0]!();
    await memo;
    expect((await bulk).skipped).toBe(0);
    // c's rev is the one the memo's answer brought.
    expect(server.log[1]).toBe('bulk review revs=1000,1001');
  });

  it('a tag or a listener carries no revs: it goes on whatever the lines hold', async () => {
    await patchPickedLines('p', ['a', 'b'], { addTagIds: ['t'] });
    expect(server.log).toEqual(['bulk undefined revs=-']);
  });
});
