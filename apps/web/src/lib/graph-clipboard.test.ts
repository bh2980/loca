import { beforeEach, describe, expect, it } from 'vitest';
import { graphClipboard, idClipboard, resetGraphClipboardForTest } from './graph-clipboard';

beforeEach(() => resetGraphClipboardForTest());

describe('graph clipboard', () => {
  it('holds one copy per kind', () => {
    graphClipboard<string[]>('people').copy(['a']);
    graphClipboard<{ nodes: string[] }>('workflow-nodes').copy({ nodes: ['n1'] });
    expect(graphClipboard<string[]>('people').read()).toEqual(['a']);
    expect(graphClipboard<{ nodes: string[] }>('workflow-nodes').read()).toEqual({ nodes: ['n1'] });
    expect(graphClipboard<string[]>('events').read()).toBeNull();
  });

  it('copying nothing keeps what was copied before', () => {
    const events = idClipboard('events');
    events.copy(['e1', 'e2']);
    events.copy([]);
    expect(events.read()).toEqual(['e1', 'e2']);
  });

  it('reads only what still exists', () => {
    const people = idClipboard('people');
    people.copy(['a', 'b', 'c']);
    expect(people.read((id) => id !== 'b')).toEqual(['a', 'c']);
  });

  it('a later change to the copied list does not change the copy', () => {
    const ids = ['a'];
    idClipboard('dialogue-nodes').copy(ids);
    ids.push('b');
    expect(idClipboard('dialogue-nodes').read()).toEqual(['a']);
  });
});
