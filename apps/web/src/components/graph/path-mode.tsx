import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LineCard } from '@/components/graph/line-card';
import { FlowPane } from '@/components/graph/node-detail';
import { PathGraph, type PathNodeText } from '@/components/graph/path-graph';
import { Page } from '@/components/page';
import { PaneHeader } from '@/components/pane-header';
import { SplitPane } from '@/components/split-pane';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';

/**
 * 길 따라 보기 (docs/DESIGN.md J2c): the slice of the dialogue graph for the stored choices, drawn
 * as a small graph. The selected block is the page's `node`; its lines open in the same pane as the
 * dialogue graph, and the line being translated is `edit`.
 */
export function PathMode({ projectId, toggle, node, edit, onSelect, onEdit }: {
  projectId: string;
  /** The scope/view switch, shared with the other graph modes. */
  toggle: ReactNode;
  node?: string;
  edit?: string;
  onSelect: (blockId: string | undefined) => void;
  onEdit: (unitId: string | undefined) => void;
}) {
  const route = useQuery(q.route(projectId));
  // The dialogue graph's node list carries every node's first line in one call (the whole graph, no layout needed).
  const graph = useQuery(q.graph(projectId, 'dialogue'));
  const texts = useMemo(() => new Map<string, PathNodeText>((graph.data?.nodes ?? []).map((item) => [item.id, { speaker: item.speaker, text: item.text }])), [graph.data]);
  const slice = route.data;

  const pick = useMutation({
    mutationFn: (body: { nodeId: string; armId: string | null }) => unwrap(client.projects[':projectId']['route-picks'].$put({ param: { projectId }, json: body })),
    onError: (error) => toast.error(error.message),
  });
  const reset = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['route-picks'].$delete({ param: { projectId } })),
    onError: (error) => toast.error(error.message),
  });
  const onPick = useCallback((nodeId: string, armId: string) => pick.mutate({ nodeId, armId }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const onAuto = useCallback((nodeId: string) => pick.mutate({ nodeId, armId: null }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // A selection that the new slice no longer has (another arm was picked) is forgotten.
  const block = slice?.blocks.find((item) => item.id === node);
  useEffect(() => {
    if (slice && node && !block) onSelect(undefined);
  }, [slice, node, block]); // eslint-disable-line react-hooks/exhaustive-deps
  const editIndex = block && edit ? block.unitIds.indexOf(edit) : -1;
  const editUnit = useQuery({ ...q.unit(edit ?? ''), enabled: editIndex >= 0 });
  useReportView('graph-line', [editUnit.data && { kind: '대사', id: editUnit.data.id, label: `${editUnit.data.key} · ${editUnit.data.source.slice(0, 40)}` }]);

  const first = useRef(performance.now());
  const ready = useCallback(() => {
    document.body.dataset.pathReady = String(Math.round(performance.now() - first.current));
  }, []);

  const choices = slice?.forks.filter((fork) => fork.mode === 'choice').length ?? 0;
  const picks = Object.keys(route.data?.picks ?? {}).length;
  const summary = slice ? `길 ${slice.lines.toLocaleString()}줄 / 전체 ${slice.totalLines.toLocaleString()}줄 · 갈림 ${choices.toLocaleString()} · 다른 갈래 ${slice.stubs.length.toLocaleString()} · 합류 ${slice.joins.length.toLocaleString()}` : undefined;
  const step = (direction: 1 | -1) => {
    const next = block?.unitIds[editIndex + direction];
    if (next) onEdit(next);
    else toast(direction === 1 ? '이 블록의 마지막 대사입니다.' : '이 블록의 첫 대사입니다.');
  };

  return (
    <Page
      title="그래프"
      meta={summary && <span className="text-sm text-muted-foreground tabular-nums" data-testid="path-summary">{summary}</span>}
      actions={
        <div className="flex items-center gap-2">
          {picks > 0 && (
            <Button variant="ghost" disabled={reset.isPending} onClick={() => reset.mutate()}>
              선택 초기화
            </Button>
          )}
          {toggle}
        </div>
      }
      flush
    >
      <SplitPane
        id="graph"
        defaultWidth="380px"
        className="absolute inset-0"
        pane={
          block && (
            <div className="h-full bg-background">
              <FlowPane
                key={block.id}
                projectId={projectId}
                nodeIds={block.nodeIds}
                title={block.kind === 'choice' ? '선택지' : block.unitIds.length > 1 ? `이어진 대사 ${block.unitIds.length}줄` : '대사'}
                editing={edit}
                onEdit={onEdit}
                onClose={() => onSelect(undefined)}
              />
            </div>
          )
        }
      >
        <div className="relative min-w-0 flex-1 bg-[radial-gradient(var(--graph-grid)_1px,transparent_1px)] [background-size:20px_20px]">
          {slice && graph.data && slice.blocks.length > 0 && (
            <PathGraph projectId={projectId} slice={slice} texts={texts} selectedId={node} onSelect={onSelect} onPick={onPick} onAuto={onAuto} onReady={ready} />
          )}
          {(route.isPending || graph.isPending) && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner /> 길을 계산하는 중…
            </div>
          )}
          {(route.isError || graph.isError) && <p className="p-6 text-sm text-destructive">길을 불러오지 못했습니다: {(route.error ?? graph.error)?.message}</p>}
          {slice && !slice.blocks.length && (
            <Empty className="absolute inset-0">
              <EmptyHeader>
                <EmptyTitle>따라갈 길이 없습니다</EmptyTitle>
                <EmptyDescription>대사 그래프가 없거나 대사가 있는 노드가 없습니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {block && editIndex >= 0 && (
            <div className="absolute bottom-3 left-3">
              <LineCard key={edit} projectId={projectId} unitId={edit!} choice={block.kind === 'choice'} position={`${editIndex + 1} / ${block.unitIds.length}`} onStep={step} onClose={() => onEdit(undefined)} />
            </div>
          )}
        </div>
      </SplitPane>
    </Page>
  );
}
