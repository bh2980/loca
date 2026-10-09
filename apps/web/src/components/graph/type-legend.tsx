import { useMemo } from 'react';
import { Shapes } from 'lucide-react';
import { isContentKind, type NodeType } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { KIND_LABEL } from './shapes';

interface Row {
  key: string;
  kind: string;
  label: string;
  description: string;
  count: number;
}

/**
 * What kinds of nodes this graph contains, grouped into content (lines/scenes) and
 * event/control nodes. Picking a row highlights those nodes on the canvas.
 */
export function TypeLegend({ nodes, nodeTypes, active, onPick }: {
  nodes: { kind: string; type: string | null }[];
  nodeTypes: Record<string, NodeType>;
  active?: string;
  onPick: (key: string | undefined) => void;
}) {
  const groups = useMemo(() => {
    const rows = new Map<string, Row>();
    for (const node of nodes) {
      const key = node.type ?? `kind:${node.kind}`;
      const row = rows.get(key);
      if (row) row.count++;
      else {
        const info = node.type ? nodeTypes[node.type] : undefined;
        rows.set(key, { key, kind: node.kind, label: info?.label ?? node.type ?? KIND_LABEL[node.kind] ?? node.kind, description: info?.description ?? '', count: 1 });
      }
    }
    const sorted = [...rows.values()].sort((a, b) => b.count - a.count);
    return [
      { title: '콘텐츠 노드', hint: '번역할 대사·장면', rows: sorted.filter((row) => isContentKind(row.kind)) },
      { title: '이벤트·제어 노드', hint: '조건 분기·대기·이벤트·상태 변경. 번역량에 포함하지 않습니다.', rows: sorted.filter((row) => !isContentKind(row.kind)) },
    ].filter((group) => group.rows.length);
  }, [nodes, nodeTypes]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('bg-background', active && 'border-[color:var(--graph-select)]')}>
          <Shapes /> 노드 종류
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="max-h-[60vh] overflow-auto py-1">
          {groups.map((group) => (
            <section key={group.title} className="px-1 py-1">
              <h3 className="px-2 pt-1 text-xs font-medium">{group.title}</h3>
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">{group.hint}</p>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.key}>
                    <button
                      className={cn('flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted', active === row.key && 'bg-muted')}
                      onClick={() => onPick(active === row.key ? undefined : row.key)}
                      title={row.description || undefined}
                    >
                      <span className="mt-0.5 w-16 shrink-0 text-[11px] text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{row.label}</span>
                        {!row.key.startsWith('kind:') && row.label !== row.key && <span className="block truncate font-mono text-[11px] text-muted-foreground">{row.key}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{row.count.toLocaleString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {active && (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => onPick(undefined)}>
              강조 해제
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
