import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleDot, Code, Flag, GitFork, Globe, ListChecks, ScanSearch, Sparkles, SpellCheck, Tag, UserCheck } from 'lucide-react';
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

/** Each node family gets its own colour band so AI calls, functions, branches and status changes read apart. */
interface Look {
  frame: string;
  header: string;
  icon: string;
  tag: string;
}
const LOOK: Record<string, Look> = {
  ai: { frame: 'border-violet-200', header: 'bg-violet-50', icon: 'text-violet-600', tag: 'AI' },
  function: { frame: 'border-sky-200', header: 'bg-sky-50', icon: 'text-sky-600', tag: '함수' },
  setStatus: { frame: 'border-emerald-300', header: 'bg-emerald-50', icon: 'text-emerald-600', tag: '상태 변경' },
  condition: { frame: 'border-amber-300', header: 'bg-amber-50', icon: 'text-amber-600', tag: '조건' },
  human: { frame: 'border-orange-300', header: 'bg-orange-50', icon: 'text-orange-600', tag: '사람' },
};
const lookOf = (node: WorkflowNode) => (node.type === 'function' && node.config.fn === 'setStatus' ? LOOK.setStatus : LOOK[node.type]);
const NEGATIVE = new Set(['error', 'fail', 'false', 'rejected']);

export type FlowNode = Node<
  {
    node: WorkflowNode;
    summary: string;
    errors: string[];
    warnings: string[];
    /** Target status of a status-change node, shown as a coloured chip. */
    status?: { name: string; color: string };
    live?: { queued: number; running: number; waiting: number; failed: number };
  },
  'workflow'
>;

/** One workflow node: input on the left, one labelled handle per exit on the right. */
export const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { node, summary, errors, warnings, status, live } = data;
  const Icon = nodeIcon(node);
  const ports = nodePorts(node);
  const ring = cn(selected && 'ring-2 ring-[color:var(--graph-select)] ring-offset-1', errors.length > 0 && 'border-destructive');

  // Entry and end are terminals: small pills, not cards.
  if (node.type === 'entry' || node.type === 'end') {
    const entry = node.type === 'entry';
    return (
      <div className={cn('flex min-w-36 items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-xs', entry ? 'border-zinc-800 bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600', ring)}>
        {!entry && <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-background !bg-zinc-400" />}
        <Icon className="size-4 shrink-0" />
        <span className="truncate font-medium">{nodeName(node)}</span>
        {entry && <span className="truncate text-xs text-zinc-300">{summary}</span>}
        {errors.length > 0 && <span className="rounded bg-destructive px-1.5 text-[11px] text-white">오류</span>}
        {entry && <Handle type="source" position={Position.Right} id="out" className="!size-2.5 !border-2 !border-background !bg-zinc-500" />}
      </div>
    );
  }

  const look = lookOf(node);
  return (
    <div className={cn('w-56 overflow-hidden rounded-lg border bg-background text-left shadow-xs', look.frame, ring)}>
      <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-background !bg-zinc-400" />
      <div className={cn('flex items-center gap-2 border-b px-3 py-2', look.header, look.frame)}>
        <Icon className={cn('size-4 shrink-0', look.icon)} />
        <span className="truncate text-sm font-medium">{nodeName(node)}</span>
        <span className={cn('ml-auto shrink-0 text-[10px] font-medium', look.icon)}>{look.tag}</span>
        {errors.length > 0 && <span className="rounded bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">오류 {errors.length}</span>}
        {!errors.length && warnings.length > 0 && <span className="rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700">주의</span>}
      </div>
      {status ? (
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">→</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-medium" style={{ borderColor: `${status.color}66`, backgroundColor: `${status.color}14` }}>
            <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
            {status.name}
          </span>
          {summary.includes('대표 번역') && <span className="text-muted-foreground">· 대표 번역 적용</span>}
        </div>
      ) : (
        <p className="line-clamp-2 min-h-8 px-3 py-1.5 text-xs text-muted-foreground">{summary}</p>
      )}
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
    </div>
  );
});
