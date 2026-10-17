import { describe, expect, it } from 'vitest';
import { initialRunScope } from './run-scope';

describe('run dialog scope (#54)', () => {
  it('starts on picked lines, then open scenes, then the open kind, never the whole project', () => {
    expect(initialRunScope({ unitIds: ['a'], groupIds: ['g'] })).toBe('units');
    expect(initialRunScope({ unitIds: [], groupIds: ['g'] })).toBe('here');
    expect(initialRunScope({ kind: 'ui' })).toBe('kind');
    expect(initialRunScope({})).toBeUndefined();
  });
});
