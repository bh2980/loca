import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { DetailPane, PaneSection } from '@/components/detail-pane';
import { TokenText } from '@/components/editor/source-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { client, unwrap } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';

export type JoinState = 'checked' | 'stale';

/** 점검함 / 바뀜 / 미점검: color only where it means something (바뀜 asks for another look). */
export function JoinStateChip({ state }: { state: JoinState | undefined }) {
  if (state === 'checked') return <Badge variant="outline" className="border-success/40 text-success">점검함</Badge>;
  if (state === 'stale') return <Badge variant="outline" className="border-warning/40 text-warning">바뀜</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">미점검</Badge>;
}

type Line = { unitId: string; key: string; groupId: string; speaker: string | null; source: string; translation: string | null };

/**
 * 합류 점검 (docs/DESIGN.md J2c): a join of the path view. The lines after it are reached from the
 * chosen path and from every other choice that comes back here, so each incoming route is shown
 * with its last lines, a divider, and the shared lines after the join. Read-only; a line opens in
 * the script view to be changed. The mark is stored with a signature of what was read.
 */
export function JoinCheckPane({ projectId, nodeId, onClose }: { projectId: string; nodeId: string; onClose: () => void }) {
  const detail = useQuery(q.joinDetail(projectId, nodeId));
  const project = useQuery(q.project(projectId));
  const tokens = tokenPatternOf(project.data?.formatRules ?? undefined);
  const data = detail.data;
  const mark = useMutation({
    mutationFn: (sig: string) => unwrap(client.projects[':projectId']['join-checks'][':nodeId'].$put({ param: { projectId, nodeId }, json: { sig } })),
    onError: (error) => toast.error(error.message),
  });
  const unmark = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['join-checks'][':nodeId'].$delete({ param: { projectId, nodeId } })),
    onError: (error) => toast.error(error.message),
  });
  useReportView('graph-node', [data && { kind: '합류', id: nodeId, label: `합류 점검 · ${(data.after[0]?.source ?? '').slice(0, 40)}` }]);

  const state = data?.check?.state;
  const line = (item: Line, muted = false) => (
    <li key={item.unitId} className="group flex items-start gap-2 px-3 py-2" data-testid="join-line">
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="text-xs text-muted-foreground">{item.speaker ?? '지문·문구'}</p>
        <TokenText text={item.source} source={item.source} pattern={tokens} className={cn(muted && 'text-muted-foreground')} />
        {item.translation ? <TokenText text={item.translation} source={item.source} pattern={tokens} className="text-muted-foreground" /> : <p className="text-xs text-muted-foreground">번역 없음</p>}
      </div>
      <Button variant="ghost" size="icon-xs" asChild className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: item.groupId, line: item.unitId }} title="번역 화면에서 열기" aria-label="번역 화면에서 열기">
          <FileText />
        </Link>
      </Button>
    </li>
  );

  return (
    <DetailPane
      kicker="합류 점검"
      title={data ? `${data.routes.length}개 길이 여기서 만남` : '합류 점검'}
      subtitle={data && <JoinStateChip state={state} />}
      onClose={onClose}
      loading={detail.isPending}
      bodyClassName="space-y-4 p-4"
      summary={data && <p className="text-xs text-muted-foreground">합류 뒤의 줄은 아래 길 모두에서 이어집니다. 각 길에서 읽어도 번역이 자연스러운지 확인하세요.</p>}
      footer={
        data && (
          <>
            <Button disabled={mark.isPending || unmark.isPending} onClick={() => (state === 'checked' ? unmark.mutate() : mark.mutate(data.sig))}>
              {state === 'checked' ? '점검 취소' : '점검함'}
            </Button>
            {state === 'stale' && (
              <Button variant="ghost" disabled={unmark.isPending} onClick={() => unmark.mutate()}>
                점검 취소
              </Button>
            )}
            {state === 'stale' && <span className="text-xs text-muted-foreground">점검한 뒤 이 줄들의 번역이 바뀌었습니다.</span>}
          </>
        )
      }
    >
      {detail.isError && <p className="text-sm text-destructive">합류 정보를 불러오지 못했습니다: {detail.error.message}</p>}
      {data?.routes.map((route) => (
        <PaneSection key={route.id} title={route.kind === 'path' ? (route.label ? `${route.label}에서` : '고른 길에서') : `‹${route.label}› 에서`}>
          <div className="rounded-md border" data-testid="join-route">
            <ul className="divide-y">
              {route.before.length ? route.before.map((item) => line(item)) : <li className="px-3 py-2 text-xs text-muted-foreground">이 길에는 합류 전 대사가 없습니다.</li>}
            </ul>
            <div role="separator" className="flex items-center gap-2 border-y bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              합류
              <span className="h-px flex-1 bg-border" />
            </div>
            <ul className="divide-y">{data.after.length ? data.after.map((item) => line(item)) : <li className="px-3 py-2 text-xs text-muted-foreground">합류 지점에 대사가 없습니다.</li>}</ul>
          </div>
        </PaneSection>
      ))}
    </DetailPane>
  );
}
