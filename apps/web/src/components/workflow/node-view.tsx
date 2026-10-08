import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleCheck, CircleDot, Code, Flag, GitFork, Globe, ListChecks, ScanSearch, Sparkles, SpellCheck, Tag, UserCheck } from 'lucide-react';
import { nodeName, nodePorts, type WorkflowNode } from '@tw/shared';
import { cn } from '@/lib/utils';

type Icon = typeof Sparkles;

const FUNCTION_ICON: Record<string, Icon> = {
  formatCheck: ListChecks,
  glossaryCheck: SpellCheck,
  setStatus: Tag,
  addTerms: BookPlus,
  http: Globe,
  script: Code,
};
const AI_ICON: Record<string, Icon> = { candidate: Sparkles, verdict: ScanSearch, terms: BookPlus, json: Braces };

export function nodeIcon(node: WorkflowNode): Icon {
  switch (node.type) {
    case 'entry':
      return CircleDot;
    case 'ai':
      return AI_ICON[node.config.output] ?? Sparkles;
    case 'function':
      return FUNCTION_ICON[node.config.fn] ?? Code;
    case 'condition':
      return GitFork;
    case 'human':
      return UserCheck;
    case 'end':
      return Flag;
  }
}

const ACCENT: Record<WorkflowNode['type'], string> = {
  entry: 'text-zinc-700',
  ai: 'text-violet-600',
  function: 'text-sky-600',
  condition: 'text-amber-600',
  human: 'text-orange-600',
  end: 'text-zinc-500',
};
const KIND_LABEL: Record<WorkflowNode['type'], string> = { entry: '진입', ai: 'AI', function: '함수', condition: '조건', human: '사람', end: '종료' };
const NEGATIVE = new Set(['error', 'fail', 'false', 'rejected']);

export type FlowNode = Node<{ node: WorkflowNode; summary: string; errors: string[]; warnings: string[]; live?: { queued: number; running: number; waiting: number; failed: number } }, 'workflow'>;

/** One workflow node: input on the left, one labelled handle per exit on the right. */
export const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { node, summary, errors, warnings, live } = data;
  const Icon = nodeIcon(node);
  const ports = nodePorts(node);
  return (
    <div className={cn('w-56 rounded-lg border bg-background text-left shadow-xs transition-shadow', selected && 'ring-2 ring-[color:var(--graph-select)]', errors.length > 0 && 'border-destructive/60')}>
      {node.type !== 'entry' && <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-background !bg-zinc-400" />}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon className={cn('size-4 shrink-0', ACCENT[node.type])} />
        <span className="truncate text-sm font-medium">{nodeName(node)}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{KIND_LABEL[node.type]}</span>
        {errors.length > 0 && <span className="rounded bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">오류 {errors.length}</span>}
        {!errors.length && warnings.length > 0 && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700">주의</span>}
      </div>
      <p className="line-clamp-2 min-h-8 px-3 py-1.5 text-xs text-muted-foreground">{summary}</p>
      {live && live.queued + live.running + live.waiting + live.failed > 0 && (
        <div className="flex gap-2 border-t px-3 py-1 text-[11px] tabular-nums">
          {live.running > 0 && <span className="text-blue-600">처리 {live.running}</span>}
          {live.queued > 0 && <span className="text-muted-foreground">대기 {live.queued}</span>}
          {live.waiting > 0 && <span className="text-orange-600">사람 {live.waiting}</span>}
          {live.failed > 0 && <span className="text-destructive">실패 {live.failed}</span>}
        </div>
      )}
      {ports.length > 0 && (
        <div className="border-t py-1">
          {ports.map((port) => (
            <div key={port.id} className="relative flex h-6 items-center justify-end pr-3 text-[11px] text-muted-foreground">
              {port.label}
              <Handle type="source" position={Position.Right} id={port.id} className={cn('!size-2.5 !border-2 !border-background', NEGATIVE.has(port.id) ? '!bg-rose-400' : '!bg-zinc-500')} />
            </div>
          ))}
        </div>
      )}
      {node.type === 'end' && (
        <div className="flex items-center gap-1 border-t px-3 py-1 text-[11px] text-muted-foreground">
          <CircleCheck className="size-3" /> 흐름 종료
        </div>
      )}
    </div>
  );
});
