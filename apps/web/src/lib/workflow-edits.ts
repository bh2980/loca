/**
 * Channel from the chat's `edit_workflow_node` proposals to the open workflow editor.
 * The editor owns the unsaved draft, so it applies the change there; nothing is saved until the user saves.
 */
export interface WorkflowNodeEdit {
  workflowId: string;
  nodeId: string;
  field: 'instructions' | 'expression' | 'code';
  value: unknown;
  description?: string;
}

type Handler = (edit: WorkflowNodeEdit) => string | null;
const handlers = new Map<string, Handler>();

export const workflowEdits = {
  register(workflowId: string, handler: Handler) {
    handlers.set(workflowId, handler);
    return () => {
      if (handlers.get(workflowId) === handler) handlers.delete(workflowId);
    };
  },
  /** Returns an error message, or null when applied. */
  apply(edit: WorkflowNodeEdit): string | null {
    const handler = handlers.get(edit.workflowId);
    return handler ? handler(edit) : '이 워크플로의 편집기를 열어 둔 상태에서 적용하세요.';
  },
};
