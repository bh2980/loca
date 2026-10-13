import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { Decoration, EditorView, keymap, MatchDecorator, placeholder as placeholderText, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { autocompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { tokenLabel } from '@/lib/line-context';
import { cn } from '@/lib/utils';

/** Open editors by line, so the source next to one can put a token or term into it. */
const editors = new Map<string, EditorView>();

/** Puts text at the cursor of the line's open editor (from a click on its source). */
export function insertIntoLine(unitId: string, text: string) {
  const view = editors.get(unitId);
  if (!view) return false;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
  return true;
}

export interface TranslationInputProps {
  unitId: string;
  value: string;
  onChange: (value: string) => void;
  source: string;
  /** Any format token of the project (global regex). */
  tokenPattern: RegExp | null;
  /** The source's tokens in order: ⌘1…⌘9 insert them. */
  tokens: string[];
  /** Confirmed terms the source mentions: their translations are offered while typing and marked when used. */
  terms: { source: string; target: string }[];
  onSave: () => void;
  onAdvance: () => void;
  onEscape?: () => void;
  /** ⌥1…⌥9: take the nth suggestion. */
  onPick?: (index: number) => void;
  /** Changing this to a non-zero number puts the cursor at the end of the text. */
  focusKey?: number;
  placeholder?: string;
  className?: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A format token drawn as a short chip (<d target="…"> → <d>); the full text is its tooltip. */
class TokenChip extends WidgetType {
  constructor(readonly token: string) {
    super();
  }
  eq(other: TokenChip) {
    return other.token === this.token;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = 'cm-token-chip';
    chip.textContent = tokenLabel(this.token);
    chip.title = this.token;
    return chip;
  }
}

/** A decoration plugin over every match of `pattern`: a mark with `className`, or (`chip`) a token chip in its place. */
function marker(pattern: RegExp, className: string, chip = false) {
  const decorator = new MatchDecorator({ regexp: pattern, decoration: (match) => (chip ? Decoration.replace({ widget: new TokenChip(match[0]) }) : Decoration.mark({ class: className })) });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** What depends on the line's source and the glossary: token chips (moved over and deleted whole), term marks, completion. */
function context(props: Pick<TranslationInputProps, 'tokenPattern' | 'tokens' | 'terms'>) {
  const extensions = [];
  if (props.tokenPattern) {
    const chips = marker(new RegExp(props.tokenPattern.source, 'gu'), 'cm-token-chip', true);
    extensions.push(chips, EditorView.atomicRanges.of((view) => view.plugin(chips)?.decorations ?? Decoration.none));
  }
  const targets = [...new Set(props.terms.map((term) => term.target))].sort((a, b) => b.length - a.length);
  if (targets.length) extensions.push(marker(new RegExp(targets.map(escape).join('|'), 'gu'), 'cm-term-hit'));
  const options = [
    ...props.terms.map((term) => ({ label: term.target, detail: term.source, type: 'keyword', boost: 2 })),
    ...[...new Set(props.tokens)].map((token) => ({ label: token, detail: '서식', type: 'variable' })),
  ];
  if (options.length)
    extensions.push(
      autocompletion({
        icons: false,
        override: [
          (completion: CompletionContext) => {
            const word = completion.matchBefore(/[\p{L}\p{N}{%<$[\\]+/u);
            if (!word || (word.from === word.to && !completion.explicit)) return null;
            return { from: word.from, options, validFor: /^[\p{L}\p{N}{%<$[\\]*$/u };
          },
        ],
      }),
    );
  return extensions;
}

/** CodeMirror's base theme outranks the stylesheet, so the box's look is set here (tokens only). */
const theme = EditorView.theme({
  '&': { fontSize: 'inherit', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  // The base theme sets a monospace font; the box reads like the other fields.
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5' },
  '.cm-content': { padding: '0', minHeight: '2.75rem', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', overflow: 'hidden', boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', minWidth: '10rem', maxWidth: '20rem' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-completionDetail': { marginLeft: 'auto', color: 'var(--muted-foreground)', fontStyle: 'normal', fontSize: '0.75rem' },
});

/**
 * The translation text box: plain text (what is saved is exactly what is typed), drawn by
 * CodeMirror so format tokens show as chips that cannot be half-deleted, the glossary's
 * translations are marked and offered as you type, and the source's tokens are one key away.
 */
export function TranslationInput(props: TranslationInputProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const contextSlot = useRef(new Compartment());
  // Handlers change every render; the editor reads the latest through this ref.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const run = (action: () => void) => () => (action(), true);
    const shortcuts = [
      { key: 'Mod-s', run: run(() => latest.current.onSave()) },
      { key: 'Mod-Enter', run: run(() => latest.current.onAdvance()) },
      // Esc first closes the completion list, then leaves the box.
      { key: 'Escape', run: (editor: EditorView) => completionStatus(editor.state) === null && (editor.contentDOM.blur(), latest.current.onEscape?.(), true) },
      // Copy the source into the box (memoQ's Ctrl+Shift+S).
      { key: 'Mod-Shift-s', run: (editor: EditorView) => (editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: latest.current.source } }), true) },
      ...Array.from({ length: 9 }, (_, index) => [
        {
          key: `Mod-${index + 1}`,
          run: (editor: EditorView) => {
            const token = latest.current.tokens[index];
            if (!token) return false;
            const { from, to } = editor.state.selection.main;
            editor.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } });
            return true;
          },
        },
        { key: `Alt-${index + 1}`, run: () => (latest.current.onPick?.(index), !!latest.current.onPick) },
      ]).flat(),
    ];
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          Prec.highest(keymap.of(shortcuts)),
          history(),
          keymap.of([...standardKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          // CodeMirror's base theme sets a monospace font; the box reads like the other fields.
          theme,
          EditorView.contentAttributes.of({ 'aria-label': '번역', spellcheck: 'false' }),
          placeholderText(props.placeholder ?? ''),
          contextSlot.current.of(context(props)),
          EditorView.updateListener.of((update) => update.docChanged && latest.current.onChange(update.state.doc.toString())),
        ],
      }),
    });
    view.current = editor;
    editors.set(props.unitId, editor);
    return () => {
      editor.destroy();
      if (editors.get(props.unitId) === editor) editors.delete(props.unitId);
    };
  }, [props.unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The glossary or the project's format rules arrive after the editor opened.
  const contextKey = `${props.tokenPattern?.source ?? ''}\u0000${props.tokens.join('\u0001')}\u0000${props.terms.map((term) => `${term.source}=${term.target}`).join('\u0001')}`;
  useEffect(() => {
    view.current?.dispatch({ effects: contextSlot.current.reconfigure(context(latest.current)) });
  }, [contextKey]);

  // A change from outside (a suggestion taken, 되돌리기) replaces the text.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.value } });
  }, [props.value]);

  useEffect(() => {
    const editor = view.current;
    if (!props.focusKey || !editor) return;
    editor.focus();
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
  }, [props.focusKey]);

  return (
    <div
      ref={host}
      className={cn(
        'min-h-16 rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 md:text-sm',
        props.className,
      )}
    />
  );
}
