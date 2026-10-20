/** Pieces shared by the node-kind configs: shared field primitives and the node/ref types. */
import { Input, InspectorField, InspectorToggle, Switch } from '@loca/ui';
import { CONNECTION_KIND_INFO, workflowSubject, type WorkflowEdge, type WorkflowNode, type WorkflowSubject } from '@tw/shared';

export type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
export type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;
export type ConditionNode = Extract<WorkflowNode, { type: 'condition' }>;

export interface NodeRefs {
  projectId: string;
  /** The saved workflow being edited (the prompt preview reads the stored node). */
  workflowId?: string;
  statuses: { id: string; name: string; color: string; humanOnly?: boolean }[];
  tags: { id: string; name: string; color: string }[];
  connections: { id: string; name: string; kind: keyof typeof CONNECTION_KIND_INFO; baseUrl: string | null; fallback: { connectionId: string; model: string } | null }[];
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
}

/** A node setting: the panes' one field shape (InspectorField), `hint` as its description. */
export function Field({ label, hint, action, children }: { label: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <InspectorField label={label} description={hint} action={action}>
      {children}
    </InspectorField>
  );
}

/** A context item counted in lines or scenes: a switch like the others, with the count beside it while on (0 = off). */
export function CountRow({ label, unit, value, fallback, max, onChange }: { label: string; unit: string; value: number; fallback: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="min-w-0">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        {value > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input type="number" min={1} max={max} value={value} onChange={(event) => onChange(Math.max(1, Math.min(max, Number(event.target.value) || 1)))} className="h-7 w-14 text-right" aria-label={`${label} 수`} />
            {unit}
          </span>
        )}
        <Switch checked={value > 0} onCheckedChange={(on) => onChange(on ? fallback : 0)} aria-label={label} />
      </span>
    </div>
  );
}

export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <InspectorToggle label={label} checked={checked} onChange={onChange} />;
}

/** The subject of the workflow these nodes belong to (set on its entry node). */
export const refsSubject = (refs: Pick<NodeRefs, 'nodes'>): WorkflowSubject => workflowSubject({ nodes: refs.nodes });
