import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFIX, resetStoredForTest, stored, STORED } from './storage';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
};
let session: ReturnType<typeof fakeStorage>;
let local: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  resetStoredForTest();
  session = fakeStorage();
  local = fakeStorage();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', local);
});
afterEach(() => vi.unstubAllGlobals());

describe('stored values', () => {
  it('every key is declared once, under the one prefix, in its own scope', () => {
    const names = Object.values(STORED).map((key) => `${key.scope}:${key.name}`);
    expect(new Set(names).size).toBe(names.length);
    // No name is the start of another's: `a.<id>` must never read as key `a.b`.
    const plain = Object.values(STORED).map((key) => key.name);
    for (const name of plain) expect(plain.filter((other) => other !== name && other.startsWith(`${name}.`))).toEqual([]);
    stored(STORED.chatSeen, 'p1').write(5);
    stored(STORED.picked, 'glossary.p1').write(['a']);
    expect([...local.data.keys()]).toEqual([`${PREFIX}chat.seen.p1`]);
    expect([...session.data.keys()]).toEqual([`${PREFIX}picked.glossary.p1`]);
  });

  it('reads the fallback when nothing is kept, and what was written after', () => {
    const slot = stored(STORED.graphShow);
    expect(slot.read()).toBe('both');
    slot.write('source');
    expect(slot.read()).toBe('source');
    expect(local.data.get(`${PREFIX}graph.show`)).toBe('"source"');
  });

  it('writing the fallback keeps nothing', () => {
    const slot = stored(STORED.picked, 'list');
    slot.write(['a', 'b']);
    slot.write([]);
    expect(session.data.size).toBe(0);
    expect(slot.read()).toEqual([]);
  });

  it('a value that does not fit the schema, or is not JSON, reads as the fallback', () => {
    local.data.set(`${PREFIX}graph.show`, '"sideways"');
    local.data.set(`${PREFIX}graph.minimap`, 'not json');
    expect(stored(STORED.graphShow).read()).toBe('both');
    expect(stored(STORED.graphMinimap).read()).toBe(true);
  });

  it('gives the same object while the kept value does not change (a stable snapshot)', () => {
    const slot = stored(STORED.picked, 'list');
    slot.write(['a']);
    expect(slot.read()).toBe(slot.read());
    const before = slot.read();
    session.data.set(slot.key, '["a","b"]');
    expect(slot.read()).not.toBe(before);
    expect(slot.read()).toEqual(['a', 'b']);
  });

  it('tells every reader of a key when it is written, and no other key', () => {
    const heard: string[] = [];
    const stopA = stored(STORED.chatSeen, 'p1').subscribe(() => heard.push('p1'));
    stored(STORED.chatSeen, 'p2').subscribe(() => heard.push('p2'));
    stored(STORED.chatSeen, 'p1').write(1);
    stored(STORED.chatSeen, 'p1').remove();
    stopA();
    stored(STORED.chatSeen, 'p1').write(2);
    expect(heard).toEqual(['p1', 'p1']);
  });

  it('storage that throws (private mode, a full quota) never throws here: the value is held for the page', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('denied'); } };
    vi.stubGlobal('localStorage', broken);
    const slot = stored(STORED.chatOpen);
    expect(slot.read()).toBe(false);
    slot.write(true);
    expect(slot.read()).toBe(true);
    slot.remove();
    expect(slot.read()).toBe(false);
  });

  it('works where there is no storage at all', () => {
    vi.stubGlobal('sessionStorage', undefined);
    const slot = stored(STORED.routeVia, 'r');
    slot.write('scene-1');
    expect(slot.read()).toBe('scene-1');
  });
});
