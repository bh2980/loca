/**
 * What a graph copied (⌘/Ctrl+C or 복사), held for this tab by kind: every graph copies and pastes through this,
 * so a copy survives leaving the graph and coming back (and a workflow's nodes paste into another workflow).
 * It holds what the graph gives it (ids, or the copied nodes themselves); nothing here goes to the OS clipboard,
 * which keeps copying text working as usual.
 */
export type ClipboardKind = 'dialogue-nodes' | 'people' | 'events' | 'workflow-nodes';

const held = new Map<ClipboardKind, unknown>();

interface GraphClipboard<T> {
  copy: (value: T) => void;
  /** What was copied, or null. */
  read: () => T | null;
}

export function graphClipboard<T>(kind: ClipboardKind): GraphClipboard<T> {
  return {
    copy: (value) => void held.set(kind, value),
    read: () => (held.has(kind) ? (held.get(kind) as T) : null),
  };
}

/** A clipboard of ids: `known` leaves out what is gone since it was copied (deleted, or another project's). */
export function idClipboard(kind: ClipboardKind) {
  const clipboard = graphClipboard<string[]>(kind);
  return {
    copy: (ids: string[]) => void (ids.length && clipboard.copy([...ids])),
    read: (known?: (id: string) => boolean) => (clipboard.read() ?? []).filter((id) => !known || known(id)),
  };
}

/** For tests. */
export const resetGraphClipboardForTest = () => held.clear();
