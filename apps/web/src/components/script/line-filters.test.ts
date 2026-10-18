import { describe, expect, it } from 'vitest';
import { knownListenerFilter, toggleLineMarkFilter, unknownListenerFilter } from '../../lib/line-filter-state';

describe('listener filter choices', () => {
  it('selecting a named listener clears unknown and keeps other marks', () => {
    const search = { listener: 'Alice', marks: ['unknownListener', 'noted'] as const };
    expect(knownListenerFilter(search, 'Bob', true)).toEqual({ listener: 'Bob', marks: ['noted'] });
  });

  it('selecting unknown clears the named listener and preserves unrelated marks', () => {
    const search = { listener: 'Bob', marks: ['ai', 'noted'] as const };
    expect(unknownListenerFilter(search, true)).toEqual({ listener: undefined, marks: ['ai', 'noted', 'unknownListener'] });
    expect(unknownListenerFilter({ listener: 'Bob', marks: ['unknownListener', 'noted'] }, false)).toEqual({ listener: undefined, marks: ['noted'] });
  });

  it('selecting the unknown mark also clears a named listener', () => {
    expect(toggleLineMarkFilter({ listener: 'Bob', marks: ['ai'] }, 'unknownListener', true)).toEqual({ listener: undefined, marks: ['ai', 'unknownListener'] });
  });
});
