import { useEffect } from 'react';
import { useRuns, type Run } from './runs';
import { STORED, useStored } from './storage';

export type RunNoticeKind = 'completed' | 'failed' | 'paused' | 'cancelled';

export interface RunNotice {
  id: string;
  workflowName: string;
  subject: Run['subject'];
  kind: RunNoticeKind;
  total: number;
  done: number;
  failed: number;
  notice: string | null;
  endedAt: number;
  read: boolean;
}

type NoticeState = { since: number; read: string[]; dismissed: string[] };

/**
 * Turns the project's runs into the bell's dismissable notices: finished or paused runs not dismissed yet.
 * Paused runs stay listed regardless of `since`; completed and cancelled runs count only after `since`.
 */
export function runNoticesOf(runs: readonly Run[], state: NoticeState): RunNotice[] {
  const notices: RunNotice[] = [];
  for (const run of runs) {
    if (run.status === 'preparing' || run.status === 'running') continue;
    if (state.dismissed.includes(run.id)) continue;
    const done = (run.states.done ?? 0) + (run.states.skipped ?? 0);
    const failed = run.states.failed ?? 0;
    const kind: RunNoticeKind =
      run.status === 'completed' ? (failed > 0 ? 'failed' : 'completed') : run.status === 'cancelled' ? 'cancelled' : 'paused';
    const endedAt = new Date((run.finishedAt ?? run.createdAt) as string | number | Date).getTime();
    if (kind !== 'paused' && !(endedAt > state.since)) continue;
    notices.push({
      id: run.id,
      workflowName: run.workflowName,
      subject: run.subject,
      kind,
      total: run.total,
      done,
      failed,
      notice: run.notice,
      endedAt,
      read: state.read.includes(run.id),
    });
  }
  return notices.sort((a, b) => b.endedAt - a.endedAt);
}

/**
 * Stored, dismissable run notices for the status bar bell in a project.
 */
export function useRunNotices(projectId: string): {
  notices: RunNotice[];
  unread: number;
  markAllRead(): void;
  markRead(id: string): void;
  dismiss(id: string): void;
  dismissAll(): void;
} {
  const runs = useRuns(projectId);
  const [state, setState] = useStored(STORED.runNotices, projectId);

  useEffect(() => {
    if (state === null) setState((now) => now ?? { since: Date.now(), read: [], dismissed: [] });
  }, [state, setState]);

  const current: NoticeState = state ?? { since: Date.now(), read: [], dismissed: [] };
  const notices = runNoticesOf(runs.data ?? [], current);
  const unread = notices.filter((n) => !n.read).length;

  const update = (fn: (base: NoticeState) => NoticeState) => {
    const present = runs.data ? new Set(runs.data.map((r) => r.id)) : null;
    const keep = (list: string[]) => {
      const unique = [...new Set(list)];
      return present ? unique.filter((id) => present.has(id)) : unique;
    };
    setState((now) => {
      const next = fn(now ?? { since: Date.now(), read: [], dismissed: [] });
      return { since: next.since, read: keep(next.read), dismissed: keep(next.dismissed) };
    });
  };

  return {
    notices,
    unread,
    markAllRead() {
      const add = notices.filter((n) => !n.read).map((n) => n.id);
      if (!add.length) return;
      update((base) => ({ ...base, read: [...base.read, ...add] }));
    },
    markRead(id: string) {
      if (current.read.includes(id)) return;
      update((base) => (base.read.includes(id) ? base : { ...base, read: [...base.read, id] }));
    },
    dismiss(id: string) {
      update((base) => ({ ...base, dismissed: [...base.dismissed, id] }));
    },
    dismissAll() {
      const add = notices.map((n) => n.id);
      if (!add.length) return;
      update((base) => ({ ...base, dismissed: [...base.dismissed, ...add] }));
    },
  };
}
