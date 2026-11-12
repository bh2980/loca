import { describe, expect, it } from 'vitest';
import { afterBoxPick, afterSelectChanges, menuTargets, selectionOf, toggled } from './graph-selection';

const set = (...ids: string[]) => new Set(ids);

describe('graph selection rules', () => {
  it('the keys act on the picked set, else on the open item', () => {
    expect(selectionOf(set('a', 'b'), 'c')).toEqual(['a', 'b']);
    expect(selectionOf(set(), 'c')).toEqual(['c']);
    expect(selectionOf(set(), undefined)).toEqual([]);
  });

  it('a menu on a picked node acts on the whole set, on another node on that one', () => {
    expect(menuTargets(set('a', 'b'), 'a')).toEqual(['a', 'b']);
    expect(menuTargets(set('a', 'b'), 'c')).toEqual(['c']);
  });

  it('toggling adds a node or takes it back', () => {
    expect([...toggled(set('a'), 'b')]).toEqual(['a', 'b']);
    expect([...toggled(set('a', 'b'), 'a')]).toEqual(['b']);
  });

  it('React Flow select changes start from the open item', () => {
    // ⌘/Ctrl+click on b while a is open in the pane: both are picked.
    expect([...afterSelectChanges(['a'], [{ id: 'b', selected: true }])]).toEqual(['a', 'b']);
    expect([...afterSelectChanges(['a', 'b'], [{ id: 'a', selected: false }])]).toEqual(['b']);
  });

  describe('a box or modifier-click on the canvas', () => {
    it('a plain box replaces the picked set', () => {
      expect([...afterBoxPick({ picked: set('a'), ids: ['b', 'c'], additive: false })]).toEqual(['b', 'c']);
    });

    it('with ⌘/Ctrl it adds, starting from the open item when nothing is picked', () => {
      expect([...afterBoxPick({ picked: set(), single: 'open', ids: ['b'], additive: true })]).toEqual(['open', 'b']);
      expect([...afterBoxPick({ picked: set('a'), single: 'open', ids: ['b'], additive: true })]).toEqual(['a', 'b']);
    });

    it('a modifier-click on a picked node takes it back; a box over it keeps it', () => {
      expect([...afterBoxPick({ picked: set('a', 'b'), ids: ['a'], additive: true })]).toEqual(['b']);
      expect([...afterBoxPick({ picked: set('a', 'b'), ids: ['a', 'c'], additive: true })]).toEqual(['a', 'b', 'c']);
    });

    it('a collecting mode keeps the set without a modifier, and never takes a node back by a box', () => {
      expect([...afterBoxPick({ picked: set('a'), single: 'open', ids: ['a'], additive: false, keep: true })]).toEqual(['a']);
      expect([...afterBoxPick({ picked: set('a'), ids: ['b'], additive: false, keep: true })]).toEqual(['a', 'b']);
    });

    it('leaves out what cannot be picked', () => {
      expect([...afterBoxPick({ picked: set(), ids: ['a', 'portal:1'], additive: false, pickable: (id) => !id.startsWith('portal:') })]).toEqual(['a']);
    });
  });
});
