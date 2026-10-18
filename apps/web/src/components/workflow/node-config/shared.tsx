/** Pieces shared by the node-kind configs: row layouts and the node/ref types. */
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Input, Label, Switch, ControlIdContext } from '@loca/ui';
import { CONNECTION_KIND_INFO, type WorkflowNode } from '@tw/shared';

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
  // The label names its control (an input, text area or select inside takes this id).
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-2">
        <Label htmlFor={id} className="min-w-0 leading-snug text-xs">
          {label}
        </Label>
        {action}
      </div>
      <ControlIdContext.Provider value={id}>{children}</ControlIdContext.Provider>
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

/**
 * One part of a node's settings (출력 · 모델 · 지시 · 문맥 · 묶음, #48): a heading that folds it away.
 * Open by default, so nothing is hidden until the person folds it; `summary` says what is inside while it is folded.
 */
export function ConfigSection({ title, summary, children }: { title: string; summary?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen className="group/section min-w-0 pt-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="row" className="-mx-2 w-[calc(100%+1rem)] min-w-0 justify-start">
          <ChevronRight className="text-muted-foreground transition-transform group-data-[state=open]/section:rotate-90" />
          <span className="shrink-0 text-xs font-semibold">{title}</span>
          {summary && <span className="min-w-0 truncate text-xs font-normal text-muted-foreground group-data-[state=open]/section:hidden">{summary}</span>}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 space-y-5 pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
