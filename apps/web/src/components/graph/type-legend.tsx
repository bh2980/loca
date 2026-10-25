import { useMemo } from 'react';
import { Shapes } from 'lucide-react';
import { isContentKind, type NodeType } from '@tw/shared';
import { Box, Button, Heading, Popover, PopoverContent, PopoverTrigger, Text } from '@loca/ui';
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
      { title: '콘텐츠', rows: sorted.filter((row) => isContentKind(row.kind)) },
      { title: '이벤트·제어', rows: sorted.filter((row) => !isContentKind(row.kind)) },
    ].filter((group) => group.rows.length);
  }, [nodes, nodeTypes]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" background="background" borderColor={active ? 'select' : undefined}>
          <Shapes /> 노드 종류
        </Button>
      </PopoverTrigger>
      <Box asChild width={96} padding="none">
      <PopoverContent align="start">
        <Box maxHeight="60vh" overflow="auto" paddingY="tight">
          {groups.map((group) => (
            <Box as="section" key={group.title} paddingX="tight" paddingY="tight">
              <Heading as="h3" variant="group" minWidth={0} display="block" paddingX="condensed" paddingTop="tight">{group.title}</Heading>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.key}>
                    <Button
                      variant="ghost"
                      size="row"
                      items="start"
                      background={active === row.key ? 'muted' : undefined}
                      onClick={() => onPick(active === row.key ? undefined : row.key)}
                    >
                      <Text marginTop="hair" width={16} shrink={false} variant="caption" tone="muted">{KIND_LABEL[row.kind] ?? row.kind}</Text>
                      <Text minWidth={0} grow>
                        <Text display="block" truncate variant="body">{row.label}</Text>
                        {!row.key.startsWith('kind:') && row.label !== row.key && <Text display="block" truncate mono variant="caption" tone="muted">{row.key}</Text>}
                      </Text>
                      <Text variant="caption" tone="muted" tabular>{row.count.toLocaleString()}</Text>
                    </Button>
                  </li>
                ))}
              </ul>
            </Box>
          ))}
        </Box>
        {active && (
          <Box border="top" padding="condensed">
            <Button variant="ghost" width="full" onClick={() => onPick(undefined)}>
              강조 해제
            </Button>
          </Box>
        )}
      </PopoverContent>
      </Box>
    </Popover>
  );
}
