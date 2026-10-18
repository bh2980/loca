import { useMemo } from 'react';
import { Shapes } from 'lucide-react';
import { isContentKind, type NodeType } from '@tw/shared';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@loca/ui';
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
      { title: '콘텐츠 노드', rows: sorted.filter((row) => isContentKind(row.kind)) },
      { title: '이벤트·제어 노드 (번역 제외)', rows: sorted.filter((row) => !isContentKind(row.kind)) },
    ].filter((group) => group.rows.length);
  }, [nodes, nodeTypes]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('bg-background', active && 'border-[color:var(--graph-select)]')}>
          <Shapes /> 노드 종류
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="max-h-[60vh] overflow-auto py-1">
          {groups.map((group) => (
            <section key={group.title} className="px-1 py-1">
              <h3 className="px-2 pt-1 text-xs font-medium">{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.key}>
                    <Button
                      variant="ghost"
                      size="row"
                      className={cn('items-start', active === row.key && 'bg-muted')}
                      onClick={() => onPick(active === row.key ? undefined : row.key)}
                    >
                      <span className="mt-0.5 w-16 shrink-0 text-xs text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{row.label}</span>
                        {!row.key.startsWith('kind:') && row.label !== row.key && <span className="block truncate font-mono text-xs text-muted-foreground">{row.key}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{row.count.toLocaleString()}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {active && (
          <div className="border-t p-2">
            <Button variant="ghost" className="w-full" onClick={() => onPick(undefined)}>
              강조 해제
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
