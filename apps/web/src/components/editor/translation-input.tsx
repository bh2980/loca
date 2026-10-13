import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, MatchDecorator, placeholder as placeholderText, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { acceptCompletion, autocompletion, completionStatus, type CompletionContext } from '@codemirror/autocomplete';
import { chipHue, chipLabel, numberTokens, type TokenKind, type TokenUnit } from '@/lib/tokens';
import type { TagInsert } from '@/lib/tag-placement';
import { splitTokens, type SourcePart } from '@/lib/line-context';
import { cn } from '@/lib/utils';

/** Open editors by line, so the source next to one can put a token or term into it. */
const editors = new Map<string, EditorView>();
/** How each open editor numbers its tokens, for inserting from outside (a source chip). */
const numberings = new Map<string, () => { source: string; pattern: RegExp | null }>();

/**
 * Proposed tokens shown as faint chips where they would go (docs/DESIGN.md J3b B): Tab puts them
 * in, Esc or any edit drops them. Nothing changes the text until Tab.
 */
const setGhost = StateEffect.define<TagInsert[] | null>();
class GhostChip extends WidgetType {
  constructor(readonly insert: TagInsert) {
    super();
  }
  eq(other: GhostChip) {
    return other.insert.text === this.insert.text && other.insert.number === this.insert.number && other.insert.kind === this.insert.kind;
  }
  toDOM() {
    const chip = document.createElement('span');
    chip.className = `cm-token-chip cm-token-ghost ${chipHue(this.insert.number)}`;
    chip.textContent = chipLabel(this.insert.kind, this.insert.number);
    chip.title = `${this.insert.text} · Tab으로 넣기`;
    return chip;
  }
}
const ghost = StateField.define<TagInsert[] | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setGhost)) return effect.value;
    return transaction.docChanged ? null : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (inserts) =>
      inserts ? Decoration.set(inserts.map((insert, index) => Decoration.widget({ widget: new GhostChip(insert), side: insert.kind === 'close' ? -1 - index : 1 + index }).range(insert.at)), true) : Decoration.none,
    ),
});
/** Puts the ghost's tokens in, in one change (positions are those of the text as it was). */
function takeGhost(view: EditorView) {
  const inserts = view.state.field(ghost);
  if (!inserts?.length) return false;
  view.dispatch({ changes: inserts.map((insert) => ({ from: insert.at, insert: insert.text })), effects: setGhost.of(null) });
  return true;
}

/**
 * The AI continuation (docs/DESIGN.md J3b A): faint text after the cursor while it is at the end
 * of the text. Tab takes it, ⌘→ one word. The text comes from the editor's owner (the `continuation`
 * prop); an edit clears it until the owner sets it again.
 */
interface Continuation {
  text: string;
  /** The text cut into plain runs and numbered tokens, drawn as faint chips like the rest. */
  parts: SourcePart[];
}
const NO_CONTINUATION: Continuation = { text: '', parts: [] };
const setContinuation = StateEffect.define<Continuation>();
class ContinuationText extends WidgetType {
  constructor(readonly value: Continuation) {
    super();
  }
  eq(other: ContinuationText) {
    return other.value.text === this.value.text;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-continuation';
    span.title = 'Tab으로 받기';
    for (const part of this.value.parts) {
      if (!part.token) {
        span.append(part.text);
        continue;
      }
      const chip = document.createElement('span');
      chip.className = `cm-token-chip cm-token-ghost ${chipHue(part.token.number)}`;
      chip.textContent = chipLabel(part.token.kind, part.token.number);
      span.append(chip);
    }
    return span;
  }
}
const continuation = StateField.define<Continuation>({
  create: () => NO_CONTINUATION,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setContinuation)) return effect.value;
    return transaction.docChanged ? NO_CONTINUATION : value;
  },
  provide: (field) =>
    EditorView.decorations.compute([field, 'selection'], (state) => {
      const { text } = state.field(field);
      const { empty, head } = state.selection.main;
      if (!text || !empty || head !== state.doc.length || state.field(ghost)) return Decoration.none;
      return Decoration.set([Decoration.widget({ widget: new ContinuationText(state.field(field)), side: 1 }).range(head)]);
    }),
});
/** Tab: the picked completion first (a term or token the person is choosing), then proposed tokens, then the continuation. */
function takeOffer(view: EditorView) {
  return (completionStatus(view.state) === 'active' && acceptCompletion(view)) || takeGhost(view) || takeContinuation(view);
}

/** Puts in the continuation, or (`word`) its first word. */
function takeContinuation(view: EditorView, word = false) {
  const { text } = view.state.field(continuation);
  const { empty, head } = view.state.selection.main;
  if (!text || !empty || head !== view.state.doc.length) return false;
  const taken = word ? (/^\s*\S+\s?/u.exec(text)?.[0] ?? text) : text;
  view.dispatch({ changes: { from: head, insert: taken }, selection: { anchor: head + taken.length } });
  return true;
}

/** Shows proposed tokens as ghost chips in the line's open editor; Tab takes them. */
export function proposeInLine(unitId: string, inserts: TagInsert[]) {
  const view = editors.get(unitId);
  if (!view) return false;
  view.dispatch({ effects: setGhost.of(inserts.length ? inserts : null) });
  view.focus();
  return true;
}

/** Focuses the line's open editor with the cursor at the end (where a continuation shows). */
export function focusEndOfLine(unitId: string) {
  const view = editors.get(unitId);
  if (!view) return;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}

/** The text selected in the line's open editor, if any (to prefill a term's translation). */
export function selectionInLine(unitId: string) {
  const view = editors.get(unitId);
  if (!view) return '';
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to).trim();
}

/** Puts a token unit at the selection of the line's open editor (a pair goes around it). */
export function insertUnitIntoLine(unitId: string, unit: TokenUnit) {
  const view = editors.get(unitId);
  if (!view) return false;
  insertUnit(view, unit, numberings.get(unitId)?.());
  view.focus();
  return true;
}

/** Puts text at the cursor of the line's open editor (from a click on its source). */
/** Replaces the whole text of the line's open editor (one undo step, so ⌘Z brings the old text back). */
export function replaceLineText(unitId: string, text: string) {
  const view = editors.get(unitId);
  if (!view) return false;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length }, userEvent: 'input.replace', scrollIntoView: true });
  view.focus();
  return true;
}

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
  /** The source's tokens as units (a pair, or a single token) in order: ⌥1…9 insert them. */
  units: TokenUnit[];
  /** Confirmed terms the source mentions: their translations are offered while typing and marked when used. */
  terms: { source: string; target: string }[];
  onSave: () => void;
  onAdvance: () => void;
  onEscape?: () => void;
  /** ⌥T: propose the missing format tokens (shown as ghosts, Tab takes them). */
  onPlaceTags?: () => void;
  /** The AI continuation to show after the cursor (empty = none). */
  continuation?: string;
  /** ⌥/: ask for a continuation of what is typed now. */
  onContinue?: () => void;
  /** ⌥.: open the AI 번역·다듬기 popover. */
  onAssist?: () => void;
  /** A continuation is on its way (Esc cancels it). */
  continuing?: boolean;
  /** Esc dropped the continuation, or cancelled the one on its way: not shown again until asked. */
  onDismissContinuation?: () => void;
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

/**
 * Puts unit n at the selection: a single token replaces it, a pair goes around it. With nothing
 * selected a pair goes in one tag at a time: its opener at the cursor, then (once the opener is
 * in and still unclosed) its closer wherever the cursor is next.
 */
function insertUnit(view: EditorView, unit: TokenUnit, numbering?: { source: string; pattern: RegExp | null }) {
  const { from, to } = view.state.selection.main;
  if (unit.close && from === to && numbering) {
    const unclosed = numberTokens(view.state.doc.toString(), numbering.source, numbering.pattern).some((token) => token.number === unit.number && token.kind === 'single' && token.text === unit.open);
    const tag = unclosed ? unit.close : unit.open;
    view.dispatch({ changes: { from, insert: tag }, selection: { anchor: from + tag.length } });
    return;
  }
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
    // A key pressed while a Korean syllable is still composing never reaches the keymap; it runs once the composition ends.
    let afterComposition: ((editor: EditorView) => unknown) | null = null;
    const insertNumbered = (editor: EditorView, index: number) => {
      const unit = latest.current.units[index];
      if (!unit) return false;
      insertUnit(editor, unit, { source: latest.current.source, pattern: latest.current.tokenPattern });
      return true;
    };
    const shortcuts = [
      { key: 'Mod-s', run: run(() => latest.current.onSave()) },
      { key: 'Mod-Enter', run: run(() => latest.current.onAdvance()) },
      // Tab takes what is offered: a picked completion (a glossary term, a token), then proposed tokens, then the continuation.
      { key: 'Tab', run: (editor: EditorView) => takeOffer(editor) },
      { key: 'Mod-ArrowRight', run: (editor: EditorView) => takeContinuation(editor, true) },
      { key: 'Alt-/', run: () => (latest.current.onContinue?.(), !!latest.current.onContinue) },
      { key: 'Alt-.', run: () => (latest.current.onAssist?.(), !!latest.current.onAssist) },
      // Esc first closes the completion list or drops proposed tokens, then leaves the box.
      {
        key: 'Escape',
        run: (editor: EditorView) => {
          if (completionStatus(editor.state) !== null) return false;
          if (editor.state.field(ghost)) return (editor.dispatch({ effects: setGhost.of(null) }), true);
          if (editor.state.field(continuation).text) return (editor.dispatch({ effects: setContinuation.of(NO_CONTINUATION) }), latest.current.onDismissContinuation?.(), true);
          // A continuation on its way: Esc cancels it (the box keeps the focus).
          if (latest.current.continuing) return (latest.current.onDismissContinuation?.(), true);
          editor.contentDOM.blur();
          latest.current.onEscape?.();
          return true;
        },
      },
      // Copy the source into the box (memoQ's Ctrl+Shift+S).
      { key: 'Mod-Shift-s', run: (editor: EditorView) => (editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: latest.current.source } }), true) },
    ];
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          Prec.highest(keymap.of(shortcuts)),
          // With a Korean input method on, ⌥/ and ⌥1… arrive as composing keys (keyCode 229) that the
          // keymap cannot name; the physical key (code) still says which they are.
          Prec.highest(
            EditorView.domEventHandlers({
              compositionend: (_event, editor) => {
                const later = afterComposition;
                if (!later) return false;
                afterComposition = null;
                // After CodeMirror applies the composed text and refreshes the completion.
                setTimeout(() => later(editor), 0);
                return false;
              },
              keydown: (event, view) => {
                const composing = event.isComposing || event.keyCode === 229;
                // Tab while composing: run once the composition ends (the completion then covers the whole word).
                if (composing && event.code === 'Tab') return (event.preventDefault(), (afterComposition = takeOffer), true);
                // ⌥ (Alt) shortcuts by physical key: ⌥ turns keys into other characters on a Mac, and a Korean
                // input method sends them as composing keys. ⌘1…9 / ⌘⇧T never reach the page (browser tab keys).
                if (!event.altKey || event.metaKey || event.ctrlKey) return false;
                const digit = Number(/^Digit([1-9])$/.exec(event.code)?.[1] ?? 0);
                let action: ((editor: EditorView) => unknown) | null = null;
                if (digit && event.shiftKey) action = latest.current.onPick ? () => latest.current.onPick?.(digit - 1) : null; // ⌥⇧n: suggestion n
                else if (digit) action = (editor) => insertNumbered(editor, digit - 1); // ⌥n: format token n
                else if (event.code === 'KeyT' && !event.shiftKey) action = latest.current.onPlaceTags ? () => latest.current.onPlaceTags?.() : null;
                else if (event.code === 'Slash') action = latest.current.onContinue ? () => latest.current.onContinue?.() : null;
                else if (event.code === 'Period') action = latest.current.onAssist ? () => latest.current.onAssist?.() : null;
                if (!action) return false;
                event.preventDefault();
                if (composing) afterComposition = action;
                else action(view);
                return true;
              },
            }),
          ),
          ghost,
          continuation,
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
    const numbering = () => ({ source: latest.current.source, pattern: latest.current.tokenPattern });
    numberings.set(props.unitId, numbering);
    return () => {
      editor.destroy();
      if (editors.get(props.unitId) === editor) editors.delete(props.unitId);
      if (numberings.get(props.unitId) === numbering) numberings.delete(props.unitId);
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

  // The continuation follows the owner's prop (it recomputes it as the text changes); after the
  // text effect above, whose replacement would otherwise clear it.
  useEffect(() => {
    const editor = view.current;
    const text = props.continuation ?? '';
    if (editor && editor.state.field(continuation).text !== text) editor.dispatch({ effects: setContinuation.of(text ? { text, parts: splitTokens(text, props.source, props.tokenPattern) } : NO_CONTINUATION) });
  }, [props.continuation, props.value]);

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
