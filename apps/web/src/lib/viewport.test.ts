import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStoredForTest } from './storage';
import { shortKey, viewportScope, viewportSlot } from './viewport';

let session: Map<string, string>;
beforeEach(() => {
  resetStoredForTest();
  session = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => void session.set(key, value), removeItem: (key: string) => void session.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe('stored viewports', () => {
  it('lives in the tab (sessionStorage), under one name', () => {
    viewportSlot('p1', 'events', 'vertical').write({ x: 1, y: 2, zoom: 1 });
    expect([...session.keys()]).toEqual(['loca.viewport.p1.events.vertical']);
  });

  it('keeps one viewport per project, graph and scope', () => {
    viewportSlot('p1', 'source', viewportScope('dialogue', 'vertical', '1장')).write({ x: 10, y: 20, zoom: 0.5 });
    expect(viewportSlot('p1', 'source', 'dialogue.vertical.1장').read()).toEqual({ x: 10, y: 20, zoom: 0.5 });
    expect(viewportSlot('p1', 'source', 'dialogue.horizontal.1장').read()).toBeNull();
    expect(viewportSlot('p2', 'source', 'dialogue.vertical.1장').read()).toBeNull();
    expect(viewportSlot('p1', 'workflow', 'dialogue.vertical.1장').read()).toBeNull();
  });

  it('an absent part of a scope keeps its place, so two scopes never read as one', () => {
    expect(viewportScope('dialogue', undefined, 'a')).toBe('dialogue..a');
    expect(viewportScope('dialogue', 'a', undefined)).not.toBe(viewportScope('dialogue', undefined, 'a'));
  });

  it('a viewport that is not one (a zoom of 0, a missing number) reads as nothing kept', () => {
    const slot = viewportSlot('p1', 'run', 'r1');
    // As a reload finds them: what the tab kept, read back through the key's schema.
    session.set(slot.key, JSON.stringify({ x: 0, y: 0, zoom: 0 }));
    expect(slot.read()).toBeNull();
    session.set(slot.key, JSON.stringify({ x: null, y: 0, zoom: 1 }));
    expect(slot.read()).toBeNull();
    session.set(slot.key, JSON.stringify({ x: 1, y: 2, zoom: 1.5 }));
    expect(slot.read()).toEqual({ x: 1, y: 2, zoom: 1.5 });
  });

  it('names a long description shortly, the same each time and differently for another', () => {
    const people = JSON.stringify([['a', 'b', 'c'], [['a', 'b']]]);
    expect(shortKey(people)).toBe(shortKey(people));
    expect(shortKey(people)).not.toBe(shortKey(JSON.stringify([['a', 'b'], [['a', 'b']]])));
    expect(shortKey(people)).toMatch(/^[0-9a-z]+$/);
  });
});
