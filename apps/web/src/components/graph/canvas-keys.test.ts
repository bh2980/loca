import { describe, expect, it } from 'vitest';
import { canvasKeyAction } from './canvas-keys';

describe('the source graph canvas keys', () => {
  it('arrows pan, + and − zoom, F fits, Enter opens, Esc deselects', () => {
    expect(canvasKeyAction({ key: 'ArrowDown' })).toEqual({ pan: [0, -80] });
    expect(canvasKeyAction({ key: 'ArrowLeft' })).toEqual({ pan: [80, 0] });
    expect(canvasKeyAction({ key: '+' })).toBe('zoom-in');
    expect(canvasKeyAction({ key: '=' })).toBe('zoom-in');
    expect(canvasKeyAction({ key: '-' })).toBe('zoom-out');
    expect(canvasKeyAction({ key: 'f' })).toBe('fit');
    expect(canvasKeyAction({ key: 'Enter' })).toBe('open');
    expect(canvasKeyAction({ key: 'Escape' })).toBe('deselect');
    expect(canvasKeyAction({ key: 'a' })).toBeUndefined();
  });

  it('leaves a key alone when ⌘, Ctrl or Alt is held: it is the browser\'s or another shortcut\'s', () => {
    // Find in page, page zoom.
    expect(canvasKeyAction({ key: 'f', metaKey: true })).toBeUndefined();
    expect(canvasKeyAction({ key: 'f', ctrlKey: true })).toBeUndefined();
    expect(canvasKeyAction({ key: '=', ctrlKey: true })).toBeUndefined();
    expect(canvasKeyAction({ key: '-', metaKey: true })).toBeUndefined();
    // The translation card steps along the flow with Alt+↓/↑.
    expect(canvasKeyAction({ key: 'ArrowDown', altKey: true })).toBeUndefined();
  });
});
