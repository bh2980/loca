import { describe, expect, it } from 'vitest';
import { toggledSelection } from './list-screen';

describe('a row click on a list screen', () => {
  it('opens the row, moves to another row, and closes the row that is open', () => {
    expect(toggledSelection(undefined, 'a')).toBe('a');
    expect(toggledSelection('a', 'b')).toBe('b');
    expect(toggledSelection('a', 'a')).toBeUndefined();
  });
});
