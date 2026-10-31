import { useRef } from 'react';
import { toast } from 'sonner';
import { client, unwrap } from '@/lib/api';

/** One undoable change: both directions go through the server (a delete keeps what it removed under a token). */
export interface Step {
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}
export type DeleteItem = { kind: 'characters' | 'relationships' | 'speechRules' | 'events' | 'eventLinks'; ids: string[] };

/** A name nothing has yet: "새 인물", "새 인물 2"… (compared without case). */
export const freeName = (base: string, taken: Set<string>) => {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
};

/**
 * The undo history a knowledge graph keeps (the relationship graph, the 사건 흐름): each action
 * records a step, ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z replay it through the server. `refresh` runs after
 * every action, whether it worked or not.
 */
export function useGraphHistory(projectId: string, refresh?: () => void) {
  const api = client.projects[':projectId'];
  const param = { projectId };
  const history = useRef<{ past: Step[]; future: Step[] }>({ past: [], future: [] });
  const remove = async (items: DeleteItem[]) => (await unwrap(api['knowledge-delete'].$post({ param, json: { items } }))).token;
  const restore = (token: string) => unwrap(api['knowledge-restore'].$post({ param, json: { token } }));
  const run = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      refresh?.();
    }
  };
  const record = (step: Step) => {
    history.current.past.push(step);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
  };
  /** Something just created: undo deletes it (keeping it), redo puts it back. */
  const created = (items: DeleteItem[]): Step => {
    let token = '';
    return { undo: async () => (token = await remove(items)), redo: () => restore(token) };
  };
  return {
    api,
    param,
    remove,
    restore,
    run,
    record,
    created,
    undo: () =>
      run(async () => {
        const step = history.current.past.pop();
        if (!step) return;
        await step.undo();
        history.current.future.push(step);
      }),
    redo: () =>
      run(async () => {
        const step = history.current.future.pop();
        if (!step) return;
        await step.redo();
        history.current.past.push(step);
      }),
  };
}
