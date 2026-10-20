/** Pieces shared by the node-kind configs: shared field primitives and the node/ref types. */
import { Button, Checkbox, Input, InspectorField, InspectorToggle, NODE_CARD_KIND_APPEARANCE, Switch, cn } from '@loca/ui';
import { CONNECTION_KIND_INFO, nodeName, workflowInput, type WorkflowEdge, type WorkflowNode, type WorkflowSubject } from '@tw/shared';
import { nodeIcon } from '@/components/workflow/node-view';

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
  /** Opens another node's settings (a step chip's click). */
  onOpenNode?: (id: string) => void;
}

/** The step(s) a node takes its result from, as small chips with the node's icon; a click opens that node. */
export function StepChips({ steps, refs, suffix }: { steps: WorkflowNode[]; refs: Pick<NodeRefs, 'onOpenNode'>; suffix?: string }) {
  if (!steps.length) return <p className="text-xs text-muted-foreground">앞 단계에 결과를 내는 노드가 없습니다. AI·스크립트 노드 뒤에 이으세요.</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {steps.map((step) => {
        const Icon = nodeIcon(step);
        const kind = step.type === 'function' && step.config.fn === 'setStatus' ? 'status' : step.type;
        return (
          <Button key={step.id} variant="outline" size="sm" className="h-7 gap-1.5 px-2" disabled={!refs.onOpenNode} onClick={() => refs.onOpenNode?.(step.id)} title="이 노드 열기">
            <Icon className={cn('size-3.5', NODE_CARD_KIND_APPEARANCE[kind].icon)} />
            {nodeName(step)}
          </Button>
        );
      })}
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/** A checkbox with its label (one choice in a row of them). */
export function CheckItem({ id, label, checked, onChange, title }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm" title={title}>
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      <label htmlFor={id}>{label}</label>
    </span>
  );
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


/** The workflow's input (its entry node), which decides each node's extension. */
export const refsInput = (refs: Pick<NodeRefs, 'nodes'>): WorkflowSubject => workflowInput({ nodes: refs.nodes });

/** Fields of a node's output an input can keep (top level; a list keeps its items whole). */
export function outputFieldNames(node: WorkflowNode): string[] {
  if (node.type === 'ai') {
    if (node.config.output === 'json') return node.config.fields.map((field) => field.name);
    if (node.config.output === 'verdict') return ['passed', 'issues'];
    if (node.config.output === 'choice') return ['value', 'confidence', 'reason'];
    return ['text'];
  }
  if (node.type === 'function' && node.config.fn === 'script') return ((node.config.params as { fields?: { name: string }[] }).fields ?? []).map((field) => field.name);
  return [];
}

/** Nodes before this one that leave an output: AI and script nodes. */
export function upstreamSources(node: WorkflowNode, refs: Pick<NodeRefs, 'nodes' | 'edges'>): WorkflowNode[] {
  const into = Map.groupBy(refs.edges ?? [], (edge) => edge.target);
  const before = new Set<string>();
  const stack = [node.id];
  while (stack.length)
    for (const edge of into.get(stack.pop()!) ?? [])
      if (!before.has(edge.source)) {
        before.add(edge.source);
        stack.push(edge.source);
      }
  return refs.nodes.filter((other) => other.id !== node.id && before.has(other.id) && (other.type === 'ai' || (other.type === 'function' && other.config.fn === 'script')));
}
