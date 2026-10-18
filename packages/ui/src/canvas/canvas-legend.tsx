import { cn } from '../lib/utils';

const kinds = [
  { label: 'AI', color: 'bg-ai' },
  { label: '검사', color: 'bg-primary' },
  { label: '흐름', color: 'bg-muted-foreground' },
  { label: '상태', color: 'bg-success' },
];

/** Color key for workflow node categories, shared with the canvas vocabulary. */
export function CanvasLegend() {
  return <div aria-label="노드 종류" className="flex h-9 items-center gap-3 rounded-md border border-border bg-popover px-3 text-xs text-muted-foreground shadow-sm">
    {kinds.map(({ label, color }) => <span key={label} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn('size-2 rounded-xs', color)} />{label}</span>)}
  </div>;
}
