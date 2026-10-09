import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BookPlus, Braces, CircleDot, Code, Flag, GitFork, Globe, ListChecks, ScanSearch, Sparkles, SpellCheck, Tag } from 'lucide-react';
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
    case 'end':
      return Flag;
  }
}

const NEGATIVE = new Set(['error', 'fail', 'false', 'rejected']);
const handleClass = (port: string) => cn('!size-2.5 !border-2 !border-background', NEGATIVE.has(port) ? '!bg-rose-400' : '!bg-zinc-500');
const inputHandle = <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-background !bg-zinc-400" />;

export type FlowNode = Node<
  {
    node: WorkflowNode;
    summary: string;
    errors: string[];
    warnings: string[];
    /** Target status of a status-change node, shown in that status's colour. */
    status?: { name: string; color: string };
    live?: { queued: number; running: number; failed: number };
  },
  'workflow'
>;

function Badges({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (errors.length) return <span className="shrink-0 rounded bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">오류 {errors.length}</span>;
  if (warnings.length) return <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700">주의</span>;
  return null;
}

function Live({ live }: { live?: FlowNode['data']['live'] }) {
  if (!live || live.queued + live.running + live.failed === 0) return null;
  return (
    <div className="flex gap-2 border-t px-3 py-1 text-[11px] tabular-nums">
      {live.running > 0 && <span className="text-blue-600">처리 {live.running}</span>}
      {live.queued > 0 && <span className="text-muted-foreground">대기 {live.queued}</span>}
      {live.failed > 0 && <span className="text-destructive">실패 {live.failed}</span>}
    </div>
  );
}

/** Exits listed down the right edge; the handle sits on the border, outside any clipping. */
function Exits({ ports }: { ports: { id: string; label: string }[] }) {
  if (!ports.length) return null;
  return (
    <div className="border-t py-1">
      {ports.map((port) => (
        <div key={port.id} className="relative flex h-6 items-center justify-end pr-3 text-[11px] text-muted-foreground">
          {port.label}
          <Handle type="source" position={Position.Right} id={port.id} className={handleClass(port.id)} />
        </div>
      ))}
    </div>
  );
}

/**
 * Flowchart shapes so node families differ by silhouette, not only colour:
 * terminals are pills, AI calls rounded cards, functions square boxes, status changes tags,
 * conditions diamonds (true → right, false → down).
 */
export const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { node, summary, errors, warnings, status, live } = data;
  const Icon = nodeIcon(node);
  const ports = nodePorts(node);
  const ring = cn(selected && 'ring-2 ring-[color:var(--graph-select)] ring-offset-2', errors.length > 0 && '!border-destructive');

  if (node.type === 'entry' || node.type === 'end') {
    const entry = node.type === 'entry';
    return (
      <div className={cn('flex min-w-36 items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-xs', entry ? 'border-zinc-800 bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600', ring)}>
        {!entry && inputHandle}
        <Icon className="size-4 shrink-0" />
        <span className="truncate font-medium">{nodeName(node)}</span>
        {entry && <span className="max-w-40 truncate text-xs text-zinc-300">{summary}</span>}
        <Badges errors={errors} warnings={[]} />
        {entry && <Handle type="source" position={Position.Right} id="out" className={handleClass('out')} />}
      </div>
    );
  }

  if (node.type === 'condition') {
    return (
      <div className="relative flex w-56 flex-col items-center">
        <div className="relative flex size-28 items-center justify-center">
          <div className={cn('absolute inset-3 rotate-45 rounded-md border-2 border-amber-300 bg-amber-50 shadow-xs', ring)} />
          {inputHandle}
          <Icon className="relative size-5 text-amber-600" />
          <Handle type="source" position={Position.Right} id="true" className={handleClass('true')} />
          <span className="absolute top-[38%] right-0 translate-x-full pl-2 text-[11px] text-muted-foreground">참</span>
          <Handle type="source" position={Position.Bottom} id="false" className={handleClass('false')} />
          <span className="absolute bottom-0 left-1/2 translate-y-full pl-2 text-[11px] text-muted-foreground">거짓</span>
        </div>
        <div className="mt-5 flex max-w-full items-center gap-1 px-1 text-center">
          <span className="truncate text-sm font-medium">{nodeName(node)}</span>
          <Badges errors={errors} warnings={warnings} />
        </div>
        {node.config.description && node.config.description !== nodeName(node) && <p className="line-clamp-2 px-2 text-center text-[11px] text-muted-foreground">{summary}</p>}
      </div>
    );
  }

  if (node.type === 'function' && node.config.fn === 'setStatus') {
    const color = status?.color ?? '#a1a1aa';
    return (
      <div className={cn('flex min-w-44 items-center gap-2 rounded-full border-2 bg-background py-1.5 pr-4 pl-2 shadow-xs', ring)} style={{ borderColor: color }}>
        {inputHandle}
        <span className="flex size-6 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22` }}>
          <Icon className="size-3.5" style={{ color }} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] text-muted-foreground">{nodeName(node)}</p>
          <p className="truncate text-sm font-medium">{status ? `→ ${status.name}` : '상태 그대로'}{summary.includes('대표 번역') && <span className="ml-1 text-[11px] font-normal text-muted-foreground">+ 대표 번역</span>}</p>
        </div>
        <Badges errors={errors} warnings={warnings} />
        <Handle type="source" position={Position.Right} id="out" className={handleClass('out')} />
      </div>
    );
  }

  const ai = node.type === 'ai';
  return (
    <div
      className={cn(
        'w-56 bg-background text-left shadow-xs',
        ai && 'rounded-2xl border border-violet-200',
        node.type === 'function' && 'rounded-none border border-sky-300 border-l-4 border-l-sky-500',
        ring,
      )}
    >
      {inputHandle}
      <div className={cn('flex items-center gap-2 border-b px-3 py-2', ai && 'rounded-t-2xl border-violet-100 bg-gradient-to-r from-violet-50 to-white', node.type === 'function' && 'border-sky-100 bg-sky-50/60')}>
        <Icon className={cn('size-4 shrink-0', ai ? 'text-violet-600' : 'text-sky-600')} />
        <span className={cn('truncate text-sm font-medium', node.type === 'function' && 'font-mono text-[13px]')}>{nodeName(node)}</span>
        <span className="ml-auto" />
        <Badges errors={errors} warnings={warnings} />
      </div>
      <p className="line-clamp-2 min-h-8 px-3 py-1.5 text-xs text-muted-foreground">{summary}</p>
      <Live live={live} />
      <Exits ports={ports} />
    </div>
  );
});
