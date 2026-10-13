import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, MatchDecorator, placeholder as placeholderText, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { autocompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { chipHue, chipLabel, numberTokens, type TokenKind, type TokenUnit } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/** Open editors by line, so the source next to one can put a token or term into it. */
const editors = new Map<string, EditorView>();

/** Puts a token unit at the selection of the line's open editor (a pair goes around it). */
export function insertUnitIntoLine(unitId: string, unit: TokenUnit) {
  const view = editors.get(unitId);
  if (!view) return false;
  insertUnit(view, unit);
  view.focus();
  return true;
}

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
  /** The source's tokens as units (a pair, or a single token) in order: ⌘1…⌘9 insert them. */
  units: TokenUnit[];
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

/** A format token drawn as its number in the source (⟨1 … 1⟩ for a pair, ⟨1⟩ alone, ? when the source lacks it); the full text is its tooltip. */
class TokenChip extends WidgetType {
  constructor(
    readonly token: string,
    readonly number: number,
    readonly kind: TokenKind,
  ) {
    super();
  }
  eq(other: TokenChip) {
    return other.token === this.token && other.number === this.number && other.kind === this.kind;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = this.number ? `cm-token-chip ${chipHue(this.number)}` : 'cm-token-chip cm-token-stray';
    chip.textContent = chipLabel(this.kind, this.number);
    return chip;
  }
}

/** Puts unit n at the selection: a single token replaces it, a pair goes around it. */
function insertUnit(view: EditorView, unit: TokenUnit) {
  const { from, to } = view.state.selection.main;
  if (!unit.close) view.dispatch({ changes: { from, to, insert: unit.open }, selection: { anchor: from + unit.open.length } });
  else
    view.dispatch({
      changes: [
        { from, insert: unit.open },
        { from: to, insert: unit.close },
      ],
      // Nothing selected: the cursor goes between the two tags, ready to type what they wrap.
      selection: { anchor: from === to ? from + unit.open.length : to + unit.open.length + unit.close.length },
    });
}

/** A decoration plugin over every match of `pattern`: a mark with `className`. */
function marker(pattern: RegExp, className: string) {
  const decorator = new MatchDecorator({ regexp: pattern, decoration: () => Decoration.mark({ class: className }) });
  return plugin(decorator);
}

/** Token chips numbered from the source. Numbers and pairs depend on the whole text, so any edit redraws every chip (texts are short). */
function chips(pattern: RegExp, source: string) {
  const build = (view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const token of numberTokens(view.state.doc.toString(), source, pattern)) builder.add(token.from, token.to, Decoration.replace({ widget: new TokenChip(token.text, token.number, token.kind) }));
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function plugin(decorator: MatchDecorator) {
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
function context(props: Pick<TranslationInputProps, 'tokenPattern' | 'units' | 'terms' | 'source'>) {
  const extensions = [];
  if (props.tokenPattern) {
    const tokens = chips(new RegExp(props.tokenPattern.source, 'gu'), props.source);
    extensions.push(
      tokens,
      EditorView.atomicRanges.of((view) => view.plugin(tokens)?.decorations ?? Decoration.none),
      // The full token in a tooltip as soon as the pointer is on its chip.
      hoverTooltip(
        (view, pos) => {
          const hits: { from: number; to: number; chip: TokenChip }[] = [];
          view.plugin(tokens)?.decorations.between(pos - 1, pos + 1, (from, to, decoration) => {
            if (decoration.spec.widget instanceof TokenChip) hits.push({ from, to, chip: decoration.spec.widget });
          });
          const hit = hits[0];
          if (!hit) return null;
          return {
            pos: hit.from,
            end: hit.to,
            above: true,
            create: () => {
              const dom = document.createElement('div');
              dom.textContent = hit.chip.token;
              if (!hit.chip.number) dom.append(Object.assign(document.createElement('div'), { textContent: '원문에 없는 서식', className: 'cm-chip-tip-note' }));
              return { dom };
            },
          };
        },
        { hoverTime: 80 },
      ),
    );
  }
  const targets = [...new Set(props.terms.map((term) => term.target))].sort((a, b) => b.length - a.length);
  if (targets.length) extensions.push(marker(new RegExp(targets.map(escape).join('|'), 'gu'), 'cm-term-hit'));
  const options = [
    ...props.terms.map((term) => ({ label: term.target, detail: term.source, type: 'keyword', boost: 2 })),
    ...props.units.map((unit) => ({
      label: unit.open,
      displayLabel: unit.close ? `${chipLabel('open', unit.number)} ${chipLabel('close', unit.number)}` : chipLabel('single', unit.number),
      detail: unit.open.length > 24 ? `${unit.open.slice(0, 23)}…` : unit.open,
      type: 'variable',
      apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
        view.dispatch({ selection: { anchor: from, head: to } });
        view.dispatch({ changes: { from, to } });
        insertUnit(view, unit);
      },
    })),
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
  // A chip's tooltip looks like the app's tooltips (dark, small).
  '.cm-tooltip.cm-tooltip-hover': { backgroundColor: 'var(--foreground)', color: 'var(--background)', border: 'none', borderRadius: '6px', padding: '0.375rem 0.75rem', fontSize: '0.875rem', fontFamily: 'var(--font-mono, monospace)', maxWidth: '28rem', wordBreak: 'break-all' },
  '.cm-chip-tip-note': { fontFamily: 'var(--font-sans)', opacity: '0.7' },
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
          // Unit n: a single token at the cursor, or a pair around the selection (memoQ's F9).
          run: (editor: EditorView) => {
            const unit = latest.current.units[index];
            if (!unit) return false;
            insertUnit(editor, unit);
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
  const contextKey = `${props.tokenPattern?.source ?? ''}\u0000${props.units.map((unit) => `${unit.open}${unit.close ?? ''}`).join('\u0001')}\u0000${props.terms.map((term) => `${term.source}=${term.target}`).join('\u0001')}`;
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
