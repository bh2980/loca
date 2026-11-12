import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickShortcut, shortcutActs, shortcutSections, SHORTCUT_SECTIONS, SHORTCUTS, type KeyContext, type ShortcutId } from './shortcuts';

const page: KeyContext = { typing: false, overlay: false, own: false, control: false };
const ids = Object.keys(SHORTCUTS) as ShortcutId[];

describe('where a shortcut acts', () => {
  it('a plain key is the field\'s while typing; a combination with ⌘/Ctrl or Alt still acts', () => {
    expect(shortcutActs(SHORTCUTS.lineMove, 'Down', { ...page, typing: true })).toBe(false);
    expect(shortcutActs(SHORTCUTS.lineMove, 'Down', page)).toBe(true);
    expect(shortcutActs(SHORTCUTS.lineMoveTyping, 'Alt+Down', { ...page, typing: true })).toBe(true);
    expect(shortcutActs(SHORTCUTS.help, '?', { ...page, typing: true })).toBe(false);
  });

  it('a shortcut says so when a field keeps its combination (undo, copy) or gives up its plain key (Esc)', () => {
    expect(shortcutActs(SHORTCUTS.graphUndo, 'Mod+Z', { ...page, typing: true })).toBe(false);
    expect(shortcutActs(SHORTCUTS.graphCopy, 'Mod+C', { ...page, typing: true })).toBe(false);
    expect(shortcutActs(SHORTCUTS.sourceBack, 'Esc', { ...page, typing: true })).toBe(true);
  });

  it('an open dialog or menu and the chat panel keep the keys, except from the shortcuts that act everywhere', () => {
    for (const context of [{ ...page, overlay: true }, { ...page, own: true }]) {
      expect(shortcutActs(SHORTCUTS.lineMove, 'Down', context)).toBe(false);
      expect(shortcutActs(SHORTCUTS.lineMoveTyping, 'Alt+Down', { ...context, typing: true })).toBe(false);
      expect(shortcutActs(SHORTCUTS.graphRemove, 'Delete', context)).toBe(false);
      expect(shortcutActs(SHORTCUTS.sourceBack, 'Esc', context)).toBe(false);
      expect(shortcutActs(SHORTCUTS.search, 'Mod+K', { ...context, typing: true })).toBe(true);
      expect(shortcutActs(SHORTCUTS.chat, 'Mod+I', context)).toBe(true);
    }
  });

  it('Enter on a button presses the button, not the screen\'s shortcut', () => {
    expect(shortcutActs(SHORTCUTS.lineEdit, 'Enter', { ...page, control: true })).toBe(false);
    expect(shortcutActs(SHORTCUTS.lineEdit, 'Enter', page)).toBe(true);
    expect(shortcutActs(SHORTCUTS.lineMove, 'Down', { ...page, control: true })).toBe(true);
  });

  it('picks the first of the given shortcuts that the press is and that acts there', () => {
    expect(pickShortcut({ key: 'ArrowDown' }, ['lineMove', 'lineMoveTyping'], page)).toEqual({ id: 'lineMove', combo: 'Down' });
    expect(pickShortcut({ key: 'ArrowDown', altKey: true }, ['lineMove', 'lineMoveTyping'], { ...page, typing: true })).toEqual({ id: 'lineMoveTyping', combo: 'Alt+Down' });
    expect(pickShortcut({ key: 'ArrowDown' }, ['lineMove', 'lineMoveTyping'], { ...page, typing: true })).toBeUndefined();
    expect(pickShortcut({ key: 'z', metaKey: true, shiftKey: true }, ['graphUndo', 'graphRedo'], page)).toEqual({ id: 'graphRedo', combo: 'Mod+Shift+Z' });
  });
});

describe('the shortcut list', () => {
  it('lists every declared shortcut once, under its section, in the platform\'s words', () => {
    const sections = shortcutSections(true);
    expect(sections.map((section) => section.title)).toEqual([...SHORTCUT_SECTIONS]);
    expect(sections.flatMap((section) => section.rows.map((row) => row.id)).sort()).toEqual([...ids].sort());
    const editor = sections.find((section) => section.title === '번역 편집기')!;
    expect(editor.rows.find((row) => row.id === 'editorSave')).toEqual({ id: 'editorSave', label: '저장', keys: ['⌘S'] });
    // A range prints as one key, not nine.
    expect(editor.rows.find((row) => row.id === 'editorToken')!.keys).toEqual(['⌥1…9']);
    expect(shortcutSections(false).find((section) => section.title === '번역 화면')!.rows.find((row) => row.id === 'lineMoveTyping')!.keys).toEqual(['Alt+↑', 'Alt+↓']);
  });

  it('no section is empty and no two rows of a section say the same thing', () => {
    for (const section of shortcutSections(true)) {
      expect(section.rows.length).toBeGreaterThan(0);
      expect(new Set(section.rows.map((row) => row.label)).size).toBe(section.rows.length);
    }
  });
});

/** The app's sources, and the text of every `useShortcuts(…)` call in one. */
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) && !full.endsWith(path.join('lib', 'shortcuts.ts')) ? [readFileSync(full, 'utf8')] : [];
  });
const calls = (source: string): string[] => {
  const found: string[] = [];
  for (let at = source.indexOf('useShortcuts('); at >= 0; at = source.indexOf('useShortcuts(', at + 1)) {
    let depth = 0;
    let end = at + 'useShortcuts'.length;
    do {
      if (source[end] === '(') depth++;
      if (source[end] === ')') depth--;
      end++;
    } while (depth > 0 && end < source.length);
    found.push(source.slice(at, end));
  }
  return found;
};

describe('every declared shortcut has a handler', () => {
  const app = sources(path.resolve(import.meta.dirname, '..'));
  const handled = app.flatMap(calls).join('\n');
  const read = app.join('\n');
  it.each(ids)('%s', (id) => {
    // A window shortcut is a key of a useShortcuts call; a part that reads its own key events names the declaration.
    const inHook = new RegExp(`\\b${id}\\s*:`).test(handled);
    const inPart = new RegExp(`matchedKey\\(event, SHORTCUTS\\.${id}\\.keys\\)|codeMirrorKey\\(keyOf\\('${id}'\\)\\)`).test(read);
    expect(inHook || inPart).toBe(true);
  });
});
