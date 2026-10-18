import { describe, expect, it } from 'vitest';
import { initialRunScope, snapshotRunScope } from './run-scope';

describe('run dialog scope (#54)', () => {
  it('starts on picked lines, then open scenes, then the open kind, never the whole project', () => {
    expect(initialRunScope({ unitIds: ['a'], groupIds: ['g'] })).toBe('units');
    expect(initialRunScope({ unitIds: [], groupIds: ['g'] })).toBe('here');
    expect(initialRunScope({ kind: 'ui' })).toBe('kind');
    expect(initialRunScope({})).toBeUndefined();
  });
});

describe('run dialog opening snapshot', () => {
  it('initializes a route run from its current untranslated IDs, in reading order', () => {
    const opened = snapshotRunScope({ unitIds: ['route-b', 'route-a'], groupIds: ['scene'] });
    expect(opened).toEqual({ unitIds: ['route-b', 'route-a'], groupIds: ['scene'], kind: undefined, mode: 'units' });
  });

  it('keeps the open scope when the caller clears or mutates its selection', () => {
    const unitIds = ['u1', 'u2'];
    const groupIds = ['scene-1'];
    const opened = snapshotRunScope({ unitIds, groupIds });
    unitIds.splice(0, unitIds.length, 'u3');
    groupIds.length = 0;
    expect(opened.unitIds).toEqual(['u1', 'u2']);
    expect(opened.groupIds).toEqual(['scene-1']);
    expect(opened.mode).toBe('units');
  });

  it('takes the latest scope on a later opening without changing the previous snapshot', () => {
    const before = snapshotRunScope({ unitIds: ['route-1'] });
    const after = snapshotRunScope({ unitIds: ['route-2', 'route-3'] });
    expect(before.unitIds).toEqual(['route-1']);
    expect(after.unitIds).toEqual(['route-2', 'route-3']);
    expect(after.mode).toBe('units');
  });

  it('refreshes to the current scene or non-dialogue kind after the line selection is cleared', () => {
    expect(snapshotRunScope({ unitIds: [], groupIds: ['new-scene'] }).mode).toBe('here');
    expect(snapshotRunScope({ kind: 'ui' })).toMatchObject({ mode: 'kind', kind: 'ui' });
    expect(snapshotRunScope({ kind: 'document' })).toMatchObject({ mode: 'kind', kind: 'document' });
  });

  it('does not silently widen an empty selection to dialogue or the whole project', () => {
    expect(snapshotRunScope({ unitIds: [], groupIds: [] }).mode).toBeUndefined();
    expect(snapshotRunScope({ kind: 'scene' })).toMatchObject({ mode: undefined, kind: undefined });
    expect(snapshotRunScope({}).mode).toBeUndefined();
  });
});
