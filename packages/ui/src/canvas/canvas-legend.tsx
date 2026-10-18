import { cn } from '../lib/utils';
import { NODE_CARD_KIND_APPEARANCE, type NodeCardKind } from './node-card';

const kinds: { kind: NodeCardKind; label?: string }[] = [
  { kind: 'ai' },
  { kind: 'function' },
  { kind: 'condition' },
  { kind: 'status' },
  { kind: 'entry', label: '진입·종료' },
];

/** Color key for workflow node categories, shared with the canvas vocabulary. */
export function CanvasLegend() {
  return <div aria-label="노드 종류" className="flex h-9 items-center gap-3 rounded-md border border-border bg-popover px-3 text-xs text-muted-foreground shadow-sm">
    {kinds.map(({ kind, label }) => {
      const appearance = NODE_CARD_KIND_APPEARANCE[kind];
      return <span key={kind} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn('size-2 rounded-xs', appearance.dot)} />{label ?? appearance.label}</span>;
    })}
  </div>;
}
