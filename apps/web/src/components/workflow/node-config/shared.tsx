/** Pieces shared by the node-kind configs: row layouts and the node/ref types. */
import { CONNECTION_KIND_INFO, type WorkflowNode } from '@tw/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export type AiNode = Extract<WorkflowNode, { type: 'ai' }>;
export type FunctionNode = Extract<WorkflowNode, { type: 'function' }>;
export type ConditionNode = Extract<WorkflowNode, { type: 'condition' }>;

export interface NodeRefs {
  projectId: string;
  statuses: { id: string; name: string; color: string; humanOnly?: boolean }[];
  tags: { id: string; name: string; color: string }[];
  connections: { id: string; name: string; kind: keyof typeof CONNECTION_KIND_INFO; baseUrl: string | null; fallback: { connectionId: string; model: string } | null }[];
  nodes: WorkflowNode[];
}

export function Field({ label, hint, action, children }: { label: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
        <Label className="min-w-0 leading-snug text-xs">{label}</Label>
        {action}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
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
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="min-w-0">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
