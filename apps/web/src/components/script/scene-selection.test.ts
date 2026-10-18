import { describe, expect, it } from 'vitest';
import { sceneSelectionState } from './scene-selection';

describe('scene selection', () => {
  it('reports unchecked, partial, and complete states from all matching ids', () => {
    const ids = ['visible', 'off-page-a', 'off-page-b'];
    expect(sceneSelectionState(new Set(), ids)).toBe(false);
    expect(sceneSelectionState(new Set(['visible']), ids)).toBe('indeterminate');
    expect(sceneSelectionState(new Set(ids), ids)).toBe(true);
    expect(sceneSelectionState(new Set(['visible']), [])).toBe(false);
  });
});
