import { memo, useEffect } from 'react';
import { Handle, Position, useStore, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleDot, Code, Combine, GitFork, Globe, ListChecks, MessageCircleQuestion, NotebookPen, Save, ScanSearch, Workflow, Sparkles, SpellCheck, UserCheck } from 'lucide-react';
import { byNodeType, nodeGroup, nodeName, nodePorts, type AiOutput, type FunctionName, type WorkflowNode } from '@tw/shared';
import { FlowHandle, NodeCard, type CanvasDirection, type ExitTagItem, type FoldChipProps } from '@loca/ui';

type Icon = typeof Sparkles;

/** Every function's icon, by its name in FUNCTIONS: one without an icon does not compile. */
export const FUNCTION_ICON: Record<FunctionName, Icon> = {
  formatCheck: ListChecks,
  glossaryCheck: SpellCheck,
  script: Code,
  http: Globe,
  saveCandidate: Save,
  setListener: UserCheck,
  saveTerms: BookPlus,
  saveCharacters: NotebookPen,
  saveRelationships: NotebookPen,
  saveSpeechRules: NotebookPen,
  saveEvents: NotebookPen,
  saveDocument: NotebookPen,
};
const AI_ICON: Record<AiOutput, Icon> = { text: Sparkles, verdict: ScanSearch, choice: MessageCircleQuestion, json: Braces };

export const nodeIcon = (node: WorkflowNode): Icon =>
  byNodeType(node, {
    entry: () => CircleDot,
    ai: ({ config }) => AI_ICON[config.output],
    function: ({ config }) => FUNCTION_ICON[config.fn],
    condition: () => GitFork,
    gather: () => Combine,
    call: () => Workflow,
  });

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
  /** The actions of exits no line leaves (by exit id), drawn under them; a click opens the exit. */
  exitMarks?: Record<string, ExitTagItem[]>;
  onOpenExit?: (port: string) => void;
  /** The exit open in its pane: its dot is ringed, its tags picked. */
  pickedExit?: string;
}, 'workflow'>;

/** Workflow ports move with the shared graph orientation and keep their accessible names. */
export const WorkflowNodeView = memo(function WorkflowNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const { node, summary, retry, badge, errors, warnings, live, direction, start, open, folds, foldClose, exitMarks, onOpenExit, pickedExit } = data;
  const compact = useStore((state) => state.transform[2]) < 0.4;
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
    open: open.includes(port.id) && port.id !== 'error' && !exitMarks?.[port.id]?.length,
    fold: folds?.[port.id],
    marks: exitMarks?.[port.id]?.length && onOpenExit ? { items: exitMarks[port.id]!, onOpen: () => onOpenExit(port.id), selected: pickedExit === port.id, compact } : undefined,
    handle: <FlowHandle look={handleTone(port.id)} picked={pickedExit === port.id}><Handle
      type="source"
      position={isVertical ? Position.Bottom : Position.Right}
      id={port.id}
      aria-label={portHelp[port.id] ?? port.label}
      style={isVertical
        ? { left: `${((index + 0.5) / (ports.length || 1)) * 100}%` }
        : { top: `${((index + 0.5) / (ports.length || 1)) * 100}%` }}
    /></FlowHandle>,
  }));
  const kind = nodeGroup(node);
  // A save says its verb before the name.
  const verb = kind === 'apply' ? '저장' : undefined;
  const cardIcon = <Icon />;

  return <NodeCard
    kind={kind}
    icon={cardIcon}
    title={nodeName(node)}
    summary={summary}
    retry={retry}
    badge={badge}
    verb={verb}
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
