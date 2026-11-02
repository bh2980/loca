import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleDot, Code, Combine, Flag, GitFork, Globe, ListChecks, MessageCircleQuestion, NotebookPen, ScanSearch, Workflow, Sparkles, SpellCheck, Tag, UserCheck } from 'lucide-react';
import { functionGroup, nodeName, nodePorts, type WorkflowNode } from '@tw/shared';
import { FlowHandle, NodeCard, type CanvasDirection, type FoldChipProps } from '@loca/ui';

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
const AI_ICON: Record<string, Icon> = { text: Sparkles, verdict: ScanSearch, choice: MessageCircleQuestion, json: Braces };

export function nodeIcon(node: WorkflowNode): Icon {
  switch (node.type) {
    case 'entry': return CircleDot;
    case 'ai': return AI_ICON[node.config.output] ?? Sparkles;
    case 'function': return FUNCTION_ICON[node.config.fn] ?? Code;
    case 'condition': return GitFork;
    case 'gather': return Combine;
    case 'call': return Workflow;
    case 'end': return Flag;
  }
}

export const workflowPortTone = (port: string): 'neutral' | 'warning' | 'destructive' => port === 'error'
  ? 'destructive'
  : ['fail', 'false', 'rejected'].includes(port) ? 'warning' : 'neutral';
const handleTone = (port: string) => {
  const tone = workflowPortTone(port);
  return tone === 'destructive' ? 'workflow-danger' : tone === 'warning' ? 'workflow-warning' : 'workflow';
};
const portHelp: Record<string, string> = {
  error: '오류: 모델이나 함수 실행 중 문제가 생겼을 때',
  fail: '실패: 검수 기준을 통과하지 못했을 때',
  false: '거짓: 조건식이 거짓일 때',
  rejected: '거절: 검토 결과 거절되었을 때',
};

export type FlowNode = Node<{
  node: WorkflowNode;
  summary: string;
  errors: string[];
  warnings: string[];
  /** Target status of a status-change node, shown in that status's colour. */
  status?: { name: string; color: string };
  live?: { queued: number; running: number; failed: number; calls?: number; limit?: number; passed?: number; retry?: string };
  /** An AI node's retry rules in a few words (retryBadge). */
  retry?: { text: string; detail?: string };
  /** An AI node's model, as a chip (nodeBadge). */
  badge?: string;
  direction: CanvasDirection;
  /** Lines enter here (the hidden entry node points at it): its 시작 mark, which opens the start settings. */
  start?: { label: string; onOpen?: () => void };
  /** Exits with no line leaving them: drawn with an end mark. */
  open: string[];
  /** Nodes folded into a chip on an exit (by exit id); an opened fold's chip reads 접기. */
  folds?: Record<string, FoldChipProps>;
  /** This node is folded into a line when closed: 접기 puts it back. */
  foldClose?: () => void;
}, 'workflow'>;

/** Workflow ports move with the shared graph orientation and keep their accessible names. */
export const WorkflowNodeView = memo(function WorkflowNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const { node, summary, retry, badge, errors, warnings, status, live, direction, start, open, folds, foldClose } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => updateNodeInternals(id), [direction, id, updateNodeInternals]);
  const Icon = nodeIcon(node);
  const ports = nodePorts(node);
  const isEntry = node.type === 'entry';
  const isVertical = direction === 'vertical';
  const inputHandle = !isEntry && <FlowHandle look="workflow"><Handle type="target" position={isVertical ? Position.Top : Position.Left} id="in" aria-label="입력" /></FlowHandle>;
  const outputs = ports.map((port, index) => ({
    id: port.id,
    label: port.id === 'error' ? '오류' : port.label,
    tone: workflowPortTone(port.id),
    // An unconnected 오류 ends the line failed, as everywhere: no mark for it.
    open: open.includes(port.id) && port.id !== 'error',
    fold: folds?.[port.id],
    handle: <FlowHandle look={handleTone(port.id)}><Handle
      type="source"
      position={isVertical ? Position.Bottom : Position.Right}
      id={port.id}
      aria-label={portHelp[port.id] ?? port.label}
      style={isVertical
        ? { left: `${((index + 0.5) / (ports.length || 1)) * 100}%` }
        : { top: `${((index + 0.5) / (ports.length || 1)) * 100}%` }}
    /></FlowHandle>,
  }));
  const kind = node.type === 'function' ? (node.config.fn === 'setStatus' ? 'status' : functionGroup(node.config.fn)) : node.type;
  // A status change reads as its status (a pill in its colour); a save and a tag node say their verb before the name.
  const isStatus = node.type === 'function' && node.config.fn === 'setStatus';
  const detail = isStatus ? undefined : summary;
  const verb = kind === 'apply' ? (node.type === 'function' && node.config.fn === 'tagLines' ? '태그' : '저장') : undefined;
  const cardIcon = <Icon />;

  return <NodeCard
    kind={kind}
    icon={cardIcon}
    title={isStatus && !node.label && status ? `→ ${status.name}` : nodeName(node)}
    summary={detail}
    retry={retry}
    badge={badge}
    verb={verb}
    color={isStatus ? status?.color : undefined}
    inputHandle={inputHandle}
    outputs={outputs}
    direction={direction}
    errors={errors.length}
    warnings={warnings.length}
    live={live}
    parallel={node.type === 'ai' ? node.config.concurrency : undefined}
    selected={selected}
    start={start}
    foldClose={foldClose}
    width={isEntry ? 'entry' : isVertical ? 'vertical' : 'horizontal'}
  />;
});
