/** Pieces shared by the node-kind configs: shared field primitives and the node/ref types. */
import { Box, Button, Checkbox, HelpTip, Inline, NodeKindIcon, NumberInput, InspectorToggle, Switch, Text } from '@loca/ui';
import { CONNECTION_KIND_INFO, functionGroup, leavesResult, nodeName, nodeOutputFields, workflowInput, type ModelLimits, type WorkflowEdge, type WorkflowNode, type WorkflowSubject } from '@tw/shared';
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
  connections: { id: string; name: string; kind: keyof typeof CONNECTION_KIND_INFO; baseUrl: string | null; modelLimits?: Record<string, ModelLimits> }[];
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
  /** The project's workflows (a call node picks one of them). */
  workflows?: { id: string; name: string; input: WorkflowSubject }[];
  /** Opens another node's settings (a step chip's click). */
  onOpenNode?: (id: string) => void;
}

/** The step(s) a node takes its result from, as small chips with the node's icon; a click opens that node. */
export function StepChips({ steps, refs, suffix }: { steps: WorkflowNode[]; refs: Pick<NodeRefs, 'onOpenNode'>; suffix?: string }) {
  if (!steps.length) return <Text as="p" variant="caption" tone="muted">앞 단계에 결과를 내는 노드가 없습니다. AI·스크립트 노드 뒤에 이으세요.</Text>;
  return (
    <Inline wrap gap="snug" variant="body">
      {steps.map((step) => {
        const Glyph = nodeIcon(step);
        const kind = step.type === 'function' ? functionGroup(step.config.fn) : step.type;
        return (
          <Button key={step.id} variant="outline" paddingX="condensed" disabled={!refs.onOpenNode} onClick={() => refs.onOpenNode?.(step.id)} title="이 노드 열기">
            <NodeKindIcon icon={Glyph} kind={kind} />
            {nodeName(step)}
          </Button>
        );
      })}
      {suffix && <Text tone="muted">{suffix}</Text>}
    </Inline>
  );
}

/** A checkbox with its label (one choice in a row of them). */
export function CheckItem({ id, label, checked, onChange, title }: { id: string; label: string; checked: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <Inline as="span" gap="snug" variant="body" title={title}>
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onChange(on === true)} />
      <label htmlFor={id}>{label}</label>
    </Inline>
  );
}

/** A context item counted in lines or scenes: a switch like the others, with the count beside it while on (0 = off). */
export function CountRow({ label, help, unit, value, fallback, max, onChange }: { label: string; help?: string; unit: string; value: number; fallback: number; max: number; onChange: (value: number) => void }) {
  return (
    <Inline minWidth={0} justify="between" gap="normal" variant="body">
      <Inline as="span" minWidth={0} gap="tight">{label}{help && <HelpTip>{help}</HelpTip>}</Inline>
      <Inline as="span" shrink={false} gap="condensed">
        {value > 0 && (
          <Inline as="span" gap="tight" variant="caption" tone="muted">
            <Box asChild height="control-sm" width="field-3xs" textAlign="end">
              <NumberInput min={1} max={max} value={value} onValueChange={(next) => next !== undefined && onChange(next)} aria-label={`${label} 수`} />
            </Box>
            {unit}
          </Inline>
        )}
        <Switch checked={value > 0} onCheckedChange={(on) => onChange(on ? fallback : 0)} aria-label={label} />
      </Inline>
    </Inline>
  );
}

export function ToggleRow({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <InspectorToggle label={<Inline as="span" gap="tight">{label}{help && <HelpTip>{help}</HelpTip>}</Inline>} checked={checked} onChange={onChange} />;
}


/** The workflow's input (its entry node), which decides each node's extension. */
export const refsInput = (refs: Pick<NodeRefs, 'nodes'>): WorkflowSubject => workflowInput({ nodes: refs.nodes });

/** Fields of a node's output an input can keep (top level; a list keeps its items whole): what it declares (nodeOutputFields). */
export const outputFieldNames = (node: WorkflowNode): string[] => (nodeOutputFields(node) ?? []).map((field) => field.name);

/** Nodes before this one that leave an output (leavesResult: AI, checks, script, HTTP, gather). */
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
  return refs.nodes.filter((other) => other.id !== node.id && before.has(other.id) && leavesResult(other));
}
