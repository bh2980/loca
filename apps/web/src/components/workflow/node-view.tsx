import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleDot, Code, Flag, GitFork, Globe, ListChecks, MessageCircleQuestion, NotebookPen, ScanSearch, Sparkles, SpellCheck, Tag, UserCheck } from 'lucide-react';
import { nodeName, nodePorts, type WorkflowNode } from '@tw/shared';
import { NodeCard, paletteColor } from '@loca/ui';

type Icon = typeof Sparkles;

const FUNCTION_ICON: Record<string, Icon> = {
  formatCheck: ListChecks,
  glossaryCheck: SpellCheck,
  setStatus: Tag,
  addTerms: BookPlus,
  setListener: UserCheck,
  applyKnowledge: NotebookPen,
  http: Globe,
  script: Code,
};
const AI_ICON: Record<string, Icon> = { candidate: Sparkles, verdict: ScanSearch, terms: BookPlus, listener: MessageCircleQuestion, knowledge: NotebookPen, json: Braces };

export function nodeIcon(node: WorkflowNode): Icon {
  switch (node.type) {
    case 'entry': return CircleDot;
    case 'ai': return AI_ICON[node.config.output] ?? Sparkles;
    case 'function': return FUNCTION_ICON[node.config.fn] ?? Code;
    case 'condition': return GitFork;
    case 'end': return Flag;
  }
}

const NEGATIVE = new Set(['error', 'fail', 'false', 'rejected']);
const handleClass = (port: string) => `!size-2.5 !border-2 !border-card ${NEGATIVE.has(port) ? '!bg-destructive' : '!bg-muted-foreground'}`;

export type FlowNode = Node<{
  node: WorkflowNode;
  summary: string;
  errors: string[];
  warnings: string[];
  /** Target status of a status-change node, shown in that status's colour. */
  status?: { name: string; color: string };
  live?: { queued: number; running: number; failed: number };
}, 'workflow'>;

/** Compact common node card; all graph ports now enter at top and exit at bottom. */
export const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { node, summary, errors, warnings, status, live } = data;
  const Icon = nodeIcon(node);
  const ports = nodePorts(node);
  const isEntry = node.type === 'entry';
  const inputHandle = !isEntry && <Handle type="target" position={Position.Top} id="in" className="!size-2.5 !border-2 !border-card !bg-muted-foreground" />;
  const outputs = ports.map((port, index) => ({
    id: port.id,
    label: port.label,
    negative: NEGATIVE.has(port.id),
    handle: <Handle type="source" position={Position.Bottom} id={port.id} className={handleClass(port.id)} style={{ left: `${((index + 1) / (ports.length + 1)) * 100}%` }} />,
  }));
  const kind = node.type === 'function' && node.config.fn === 'setStatus' ? 'status' : node.type;
  const detail = node.type === 'function' && node.config.fn === 'setStatus'
    ? `→ ${status?.name ?? '상태 그대로'}`
    : summary;
  const cardIcon = node.type === 'function' && node.config.fn === 'setStatus' && status
    ? <span style={{ color: paletteColor(status.color) }}><Icon /></span>
    : <Icon />;

  return <NodeCard
    kind={kind}
    icon={cardIcon}
    title={nodeName(node)}
    summary={detail}
    inputHandle={inputHandle}
    outputs={outputs}
    errors={errors.length}
    warnings={warnings.length}
    live={live}
    selected={selected}
    className={isEntry ? 'w-48' : undefined}
  />;
});
