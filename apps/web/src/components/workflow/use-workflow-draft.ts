import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { workflowDefinitionSchema, type WorkflowDefinition, type WorkflowIssue } from '@loca/shared';
import { draftText } from '@/lib/drafts';
import { useRuns } from '@/lib/runs';
import { normalizeWorkflowDraft, reconcileSavedDraft, sameWorkflowDraft } from '@/lib/workflow-draft';
import { saveWorkflow, useWorkflow, validateWorkflow } from '@/lib/workflows';

/** A workflow as the editor holds it: its name and definition, and the saved version the edit builds on. */
interface WorkflowDraft {
  baseVersion: number;
  name: string;
  definition: WorkflowDefinition;
}

/** The workflow's unsaved edit, kept like every draft (lib/drafts.ts) as JSON text. */
const draftOf = (id: string) => draftText(`workflow.${id}`);
/** The draft kept for this tab, read through the definition's schema: one that no longer fits it is dropped. */
const readDraft = (id: string): WorkflowDraft | null => {
  try {
    const kept = JSON.parse(draftOf(id).read() ?? 'null') as WorkflowDraft | null;
    const definition = kept && workflowDefinitionSchema.safeParse(kept.definition);
    return kept && definition?.success ? { ...kept, definition: definition.data } : null;
  } catch {
    return null;
  }
};
const writeDraft = (id: string, draft: WorkflowDraft | null) => draftOf(id).write(draft && JSON.stringify(draft));

/**
 * The workflow being edited: the saved row, the unsaved draft on top of it, and how the draft gets saved. Every edit
 * goes through `setDraft`; the draft survives navigation and reloads (this tab's storage) and is dropped only on save
 * or 되돌리기. It saves itself a moment after the last edit, except while a run uses the workflow (the server
 * refuses changes: the draft waits and saves once the run ends) or while it builds on a version someone else has
 * replaced (`stale`). The draft is checked on the server as it is edited, by the rules a run start uses (`issues`).
 * Mounted per workflow.
 */
export function useWorkflowDraft(projectId: string, workflowId: string) {
  const workflow = useWorkflow(projectId, workflowId);
  const runs = useRuns(projectId);
  const activeRun = runs.data?.find((run) => run.workflowId === workflowId && (run.status === 'preparing' || run.status === 'running' || run.status === 'paused'));

  const [draft, setDraftState] = useState<WorkflowDraft | null>(() => readDraft(workflowId));
  /** The draft a save request is carrying, while it is on its way. */
  const inFlight = useRef<WorkflowDraft | null>(null);
  const saved = workflow.data && { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition };
  const setDraft = useCallback(
    (update: (current: WorkflowDraft) => WorkflowDraft) =>
      setDraftState((current) => {
        const stored = workflow.data && { baseVersion: workflow.data.version, name: workflow.data.name, definition: workflow.data.definition };
        const base = current ?? stored ?? null;
        if (!base) return current;
        const next = update(base);
        // React Flow reports no-op position changes while it renders; an edit equal to the saved
        // version (or to the current draft) is not a change and must not mark the workflow dirty.
        if (!normalizeWorkflowDraft(next, stored, inFlight.current)) {
          writeDraft(workflowId, null);
          return null;
        }
        if (sameWorkflowDraft(next, base)) return current;
        writeDraft(workflowId, next);
        return next;
      }),
    [workflow.data, workflowId],
  );
  const discard = () => {
    writeDraft(workflowId, null);
    setDraftState(null);
  };
  const current = draft ?? saved;
  const stale = Boolean(draft && workflow.data && draft.baseVersion !== workflow.data.version);

  // Validate the draft on the server (same rules as run start), debounced.
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  useEffect(() => {
    if (!current) return;
    if (!draft) return setIssues(workflow.data?.issues ?? []);
    let cancelled = false;
    const timer = setTimeout(() => {
      void validateWorkflow(workflowId, current.definition)
        .then((result) => { if (!cancelled) setIssues(result); })
        .catch(() => undefined);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [current?.definition, draft, workflow.data, workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (sent: WorkflowDraft) => {
      inFlight.current = sent;
      // Done once the feed has brought the saved row, so its version is the one the draft now builds on.
      return saveWorkflow(projectId, workflowId, { name: sent.name, description: workflow.data!.description, definition: sent.definition, version: sent.baseVersion });
    },
    onSettled: () => { inFlight.current = null; },
    onSuccess: (row, sent) => {
      setDraftState((latest) => {
        const next = reconcileSavedDraft(latest, sent, row.version);
        writeDraft(workflowId, next);
        return next;
      });
      setIssues(row.issues);
    },
  });
  const running = Boolean(activeRun);
  useEffect(() => {
    if (!draft || stale || running || save.isPending || save.isError) return;
    const timer = setTimeout(() => save.mutate(draft), 800);
    return () => clearTimeout(timer);
  }, [draft, stale, running, save.isPending, save.isError, save.mutate]);

  return {
    workflow,
    activeRun,
    draft,
    /** The draft, else the saved row: what the editor shows. Undefined until the workflow has loaded. */
    current,
    stale,
    issues,
    setDraft,
    discard,
    save,
    /** An edit of this tab is unsaved or on its way: another tab's saved layout must not be taken over it. */
    editingLocally: () => Boolean(draft || save.isPending || inFlight.current),
  };
}

export type WorkflowDraftState = ReturnType<typeof useWorkflowDraft>;
