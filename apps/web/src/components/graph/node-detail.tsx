import type { ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { isContentKind } from '@tw/shared';
import { KIND_LABEL } from './shapes';
import { PaneHeader } from '@/components/pane-header';
import { DetailPane } from '@/components/detail-pane';
import { cn } from '@/lib/utils';

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
          <Button asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: groupId }}>
              <FileText /> 장면 열기
            </Link>
          </Button>
          <Button variant="outline" asChild>
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

/**
 * A dialogue-graph selection read like a script: one node or a folded run, its lines in order.
 * The speaker shows where it changes, each line's translation sits under it, a player's choice is
 * its own row. Node types, keys and raw metadata are left out: the flow of the lines is what this
 * pane is for.
 */
export function FlowPane({ projectId, nodeIds, title, onClose }: { projectId: string; nodeIds: string[]; title: string; onClose: () => void }) {
  const results = useQueries({ queries: nodeIds.map((id) => q.graphNode(id)) });
  const nodes = results.flatMap((result) => (result.data ? [result.data] : []));
  const loading = results.some((result) => result.isPending);
  const first = nodes.find((node) => node.units.length);
  const lineCount = nodes.reduce((sum, node) => sum + (node.kind === 'choice' ? 0 : node.units.length), 0);
  useReportView('graph-node', [nodes[0] && { kind: '그래프', id: nodeIds.join(','), label: title }]);

  // A table: who | what, one row per line; a choice and a condition are rows of their own.
  const row = (key: string, who: ReactNode, what: ReactNode, className?: string) => (
    <li key={key} className={cn('grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 px-3 py-1.5', className)}>
      <span className="truncate pt-px text-xs text-muted-foreground">{who}</span>
      <div className="min-w-0 text-sm">{what}</div>
    </li>
  );
  const lines = nodes.flatMap((node) => {
    if (node.kind === 'choice') return [row(node.id, '선택지', <span className="font-medium text-choice">▶ {node.units[0]?.source ?? node.label ?? node.key}</span>, 'bg-choice/5')];
    if (!node.units.length) return [row(node.id, KIND_LABEL[node.kind] ?? node.kind, <span className="text-muted-foreground">{node.label ?? node.typeInfo?.label ?? ''}</span>, 'bg-muted/40')];
    return node.units.map((unit) =>
      row(
        unit.id,
        unit.speaker ?? '지문·문구',
        <>
          <p className="whitespace-pre-wrap">{unit.source}</p>
          {unit.translation && <p className="whitespace-pre-wrap text-muted-foreground">{unit.translation}</p>}
        </>,
      ),
    );
  });

  return (
    <DetailPane
      kicker={first?.group?.title ?? '대사 그래프'}
      title={title}
      subtitle={lineCount ? `대사 ${lineCount}줄` : undefined}
      onClose={onClose}
      loading={loading && !nodes.length}
      bodyClassName="space-y-0 p-0"
      footer={
        first?.group && (
          <Button variant="outline" asChild>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: first.group.id, line: first.units[0]?.id }}>
              <FileText /> 번역 화면에서 열기
            </Link>
          </Button>
        )
      }
    >
      <ol className="divide-y border-b">{lines}</ol>
    </DetailPane>
  );
}

