import { describe, expect, it } from 'vitest';
import { codeMirrorKey, keyLabel, matchedKey, matchesKey } from './keys';

describe('keyLabel', () => {
  it("prints a combination as the person's keyboard says it", () => {
    expect(keyLabel('Mod+Shift+S', true)).toBe('⌘⇧S');
    expect(keyLabel('Mod+Shift+S', false)).toBe('Ctrl+Shift+S');
    expect(keyLabel('Alt+Up', true)).toBe('⌥↑');
    expect(keyLabel('Alt+Up', false)).toBe('Alt+↑');
    expect(keyLabel('Delete', false)).toBe('Delete');
    expect(keyLabel('Plus', true)).toBe('+');
    expect(keyLabel('F', false)).toBe('F');
    expect(keyLabel('Alt+1…9', true)).toBe('⌥1…9');
  });
});

describe('matchesKey', () => {
  it('Mod is ⌘ or Ctrl, and a combination without it does not act with either held', () => {
    expect(matchesKey({ key: 'k', metaKey: true }, 'Mod+K')).toBe(true);
    expect(matchesKey({ key: 'K', ctrlKey: true }, 'Mod+K')).toBe(true);
    expect(matchesKey({ key: 'k' }, 'Mod+K')).toBe(false);
    expect(matchesKey({ key: 'f', metaKey: true }, 'F')).toBe(false);
    expect(matchesKey({ key: 'ArrowDown', ctrlKey: true }, 'Down')).toBe(false);
  });

  it('Shift and Alt must be exactly as named for letters and named keys', () => {
    expect(matchesKey({ key: 'z', metaKey: true }, 'Mod+Z')).toBe(true);
    expect(matchesKey({ key: 'Z', metaKey: true, shiftKey: true }, 'Mod+Z')).toBe(false);
    expect(matchesKey({ key: 'Z', metaKey: true, shiftKey: true }, 'Mod+Shift+Z')).toBe(true);
    expect(matchesKey({ key: 'ArrowDown', altKey: true }, 'Down')).toBe(false);
    expect(matchesKey({ key: 'ArrowDown', altKey: true }, 'Alt+Down')).toBe(true);
    expect(matchesKey({ key: 'ArrowDown' }, 'Alt+Down')).toBe(false);
    expect(matchesKey({ key: 'F', shiftKey: true }, 'F')).toBe(false);
    expect(matchesKey({ key: 'Escape' }, 'Esc')).toBe(true);
  });

  it('a symbol does not care about Shift: which layout needs it for ? or + is not ours to know', () => {
    expect(matchesKey({ key: '?', shiftKey: true }, '?')).toBe(true);
    expect(matchesKey({ key: '?' }, '?')).toBe(true);
    expect(matchesKey({ key: '+', shiftKey: true }, 'Plus')).toBe(true);
    expect(matchesKey({ key: '=' }, 'Plus')).toBe(true);
    expect(matchesKey({ key: '-' }, 'Minus')).toBe(true);
  });

  it('with Alt the key is read by its place: Alt changes the character on a Mac and under a Korean input method', () => {
    expect(matchesKey({ key: '˜', code: 'KeyN', altKey: true }, 'Alt+N')).toBe(true);
    expect(matchesKey({ key: 'Process', code: 'KeyT', altKey: true }, 'Alt+T')).toBe(true);
    expect(matchesKey({ key: '¡', code: 'Digit1', altKey: true }, 'Alt+1')).toBe(true);
    expect(matchesKey({ key: '⁄', code: 'Digit1', altKey: true, shiftKey: true }, 'Alt+1')).toBe(false);
    expect(matchesKey({ key: '⁄', code: 'Digit1', altKey: true, shiftKey: true }, 'Alt+Shift+1')).toBe(true);
    expect(matchesKey({ key: '÷', code: 'Slash', altKey: true }, 'Alt+/')).toBe(true);
    expect(matchesKey({ key: '≥', code: 'Period', altKey: true }, 'Alt+.')).toBe(true);
    expect(matchesKey({ key: 'n', code: 'KeyN', altKey: true, shiftKey: true }, 'Alt+N')).toBe(false);
  });

  it('matchedKey says which of several combinations was pressed', () => {
    expect(matchedKey({ key: 'ArrowUp' }, ['Up', 'Down'])).toBe('Up');
    expect(matchedKey({ key: 'y', ctrlKey: true }, ['Mod+Shift+Z', 'Mod+Y'])).toBe('Mod+Y');
    expect(matchedKey({ key: 'a' }, ['Up', 'Down'])).toBeUndefined();
  });
});

describe('codeMirrorKey', () => {
  it("spells a combination as CodeMirror's keymap does", () => {
    expect(codeMirrorKey('Mod+S')).toBe('Mod-s');
    expect(codeMirrorKey('Mod+Shift+S')).toBe('Mod-Shift-s');
    expect(codeMirrorKey('Mod+Enter')).toBe('Mod-Enter');
    expect(codeMirrorKey('Esc')).toBe('Escape');
    expect(codeMirrorKey('Mod+Right')).toBe('Mod-ArrowRight');
    expect(codeMirrorKey('Alt+/')).toBe('Alt-/');
    expect(codeMirrorKey('Tab')).toBe('Tab');
  });
});
