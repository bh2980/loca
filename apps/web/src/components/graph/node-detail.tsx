import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowUpLeft, FileText, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { isContentKind } from '@tw/shared';
import { KIND_LABEL } from './shapes';
import { PaneHeader } from '@/components/pane-header';

function Neighbour({ items, title, icon: Icon, onSelect }: { items: { id: string; key: string; kind: string; label: string | null; edgeLabel: string | null }[]; title: string; icon: typeof ArrowDownRight; onSelect: (id: string) => void }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {title} {items.length}
      </h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => onSelect(item.id)}>
              <span className="text-muted-foreground">{KIND_LABEL[item.kind] ?? item.kind}</span> {item.label ?? item.key}
              {item.edgeLabel && <span className="ml-1 text-xs text-muted-foreground">[{item.edgeLabel}]</span>}
            </button>
          </li>
        ))}
        {!items.length && <li className="px-2 text-sm text-muted-foreground">없음</li>}
      </ul>
    </section>
  );
}

/** Dialogue-graph node: its lines, raw metadata and neighbours (extracted relations only). */
export function DialogueNodeDetail({ projectId, nodeId, onSelect, onClose }: { projectId: string; nodeId: string; onSelect: (id: string) => void; onClose: () => void }) {
  const node = useQuery(q.graphNode(nodeId));
  useReportView('graph-node', [node.data && { kind: '그래프 노드', id: node.data.id, label: `${KIND_LABEL[node.data.kind] ?? node.data.kind} ${node.data.label ?? node.data.key}` }]);
  if (!node.data) return <Skeleton className="m-4 h-24" />;
  const data = node.data;
  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        kicker={`${isContentKind(data.kind) ? '콘텐츠' : '이벤트·제어'} · ${KIND_LABEL[data.kind] ?? data.kind}`}
        title={data.label ?? data.typeInfo?.label ?? data.key}
        subtitle={
          <span className="truncate font-mono">
            {data.key}
            {data.type && ` · ${data.type}`}
          </span>
        }
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {data.typeInfo?.description && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{data.typeInfo.description}</p>}
          {data.group && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: data.group.id, line: data.units[0]?.id }}>
                <FileText /> {data.group.title}에서 보기
              </Link>
            </Button>
          )}
          {data.units.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">대사 {data.units.length}</h3>
              <ul className="space-y-2">
                {data.units.map((unit) => (
                  <li key={unit.id} className="rounded-md border p-2.5 text-sm">
                    {unit.speaker && <p className="text-xs font-medium text-muted-foreground">{unit.speaker}</p>}
                    <p className="whitespace-pre-wrap">{unit.source}</p>
                    {unit.translation && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{unit.translation}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Neighbour title="들어오는 연결" icon={ArrowUpLeft} items={data.incoming} onSelect={onSelect} />
          <Neighbour title="나가는 연결" icon={ArrowDownRight} items={data.outgoing} onSelect={onSelect} />
          {data.meta && Object.keys(data.meta).length > 0 && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">원본 메타데이터</h3>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-[11px]">{JSON.stringify(data.meta, null, 2)}</pre>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Scene-graph node. Scene links are derived from the dialogue graph, which the panel says plainly. */
export function SceneNodeDetail({ projectId, groupId, onClose }: { projectId: string; groupId: string; onClose: () => void }) {
  const group = useQuery(q.group(groupId));
  useReportView('graph-node', [group.data && { kind: '장면', id: group.data.id, label: group.data.title }]);
  if (!group.data) return <Skeleton className="m-4 h-24" />;
  return (
    <div className="flex h-full flex-col">
      <PaneHeader kicker="장면" title={group.data.title} subtitle={<span className="font-mono">{group.data.key}</span>} onClose={onClose} />
      <div className="space-y-3 p-4">
        {group.data.description && <p className="text-sm">{group.data.description}</p>}
        <div className="flex flex-col gap-2">
          <Button size="sm" asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: groupId }}>
              <FileText /> 장면 열기
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/p/$projectId/graph" params={{ projectId }} search={{ scope: 'dialogue', scene: groupId }}>
              <Network /> 대사 그래프에서 보기
            </Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">장면 사이 연결은 대사 그래프에서 파생한 것입니다. 원본에 장면 순서가 기록된 것은 아닙니다.</p>
      </div>
    </div>
  );
}
