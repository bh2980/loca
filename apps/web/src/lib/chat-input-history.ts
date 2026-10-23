import type { UIMessage } from 'ai';

/** What the person has typed in this conversation, newest first: sent messages and ones sent while a reply ran. */
export function sentTexts(messages: UIMessage[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    const meta = message.metadata as { kind?: string } | undefined;
    if (message.role === 'user') {
      if (meta?.kind === 'decisions') continue;
      const text = message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
      if (text.trim()) texts.push(text);
      continue;
    }
    for (const part of message.parts) {
      const data = part.type === 'data-steer' ? (part as { data: { text: string; kind?: string } }).data : null;
      if (data && data.kind !== 'decisions' && data.text.trim()) texts.push(data.text);
    }
  }
  return texts.reverse();
}

/** `index` null: not browsing history; `draft` is what the box held before the first ↑. */
export type HistoryState = { index: number | null; draft: string };
export const NO_HISTORY: HistoryState = { index: null, draft: '' };

/**
 * ↑/↓ in the message box. Only when the caret is on the first line (↑) or the last (↓), so
 * moving through a long message still works; an empty box always counts as the first line.
 * Returns null when the key is left to the textarea.
 */
export function stepHistory(history: string[], state: HistoryState, key: 'up' | 'down', value: string, caret: number): { state: HistoryState; value: string } | null {
  if (key === 'up') {
    if (!history.length || value.slice(0, caret).includes('\n')) return null;
    const index = state.index === null ? 0 : Math.min(state.index + 1, history.length - 1);
    if (state.index === index) return null;
    return { state: { index, draft: state.index === null ? value : state.draft }, value: history[index] };
  }
  if (state.index === null || value.slice(caret).includes('\n')) return null;
  if (state.index === 0) return { state: NO_HISTORY, value: state.draft };
  return { state: { index: state.index - 1, draft: state.draft }, value: history[state.index - 1] };
}
