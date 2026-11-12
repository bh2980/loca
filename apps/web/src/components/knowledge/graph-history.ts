import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { knowledgeWrites, type KnowledgeDelete } from '@/lib/knowledge';
import { serverUndoHistory, undoChange } from '@/lib/undo';
import { createdStep, type UndoStep } from '@/lib/undo-history';

export type DeleteItem = KnowledgeDelete;

/** A name nothing has yet: "새 인물", "새 인물 2"… (compared without case). */
export const freeName = (base: string, taken: Set<string>) => {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
};

/**
 * The undo history a knowledge graph keeps (the relationship graph, the 사건 흐름): each action
 * records a step, ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay it through the server (lib/undo-history.ts).
 */
export function useGraphHistory(projectId: string) {
  const writes = useMemo(() => knowledgeWrites(projectId), [projectId]);
  const history = useRef(serverUndoHistory()).current;
  /** Puts back what a delete removed, by its token (null: it removed nothing). */
  const restore = async (token: string | null) => void (token && (await undoChange(projectId, token)));
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return {
    writes,
    remove: writes.remove,
    restore,
    run,
    record: (step: UndoStep) => history.record(step),
    /** Something just created: undo deletes it (keeping it), redo puts it back. */
    created: (items: DeleteItem[]): UndoStep => createdStep(() => writes.remove(items), (token) => undoChange(projectId, token)),
    undo: () => run(() => history.undo()),
    redo: () => run(() => history.redo()),
  };
}
