import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { InspectorHeader, Inspector, InspectorBlock, InspectorList, InspectorResult, InspectorSection, Badge, Button } from '@loca/ui';
import { TokenText } from '@/components/editor/source-text';
import { client, unwrap } from '@/lib/api';
import { tokenPatternOf } from '@/lib/line-context';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import { cn } from '@/lib/utils';

export type SeamState = 'checked' | 'stale';

/** 점검함 / 바뀜 / 미점검: color only where it means something (바뀜 asks for another look). */
export function SeamStateChip({ state, className }: { state: SeamState | undefined; className?: string }) {
  if (state === 'checked') return <Badge variant="outline" className={cn('border-success/40 text-success', className)}>점검함</Badge>;
  if (state === 'stale') return <Badge variant="outline" className={cn('border-warning/40 text-warning', className)}>바뀜</Badge>;
  return <Badge variant="outline" className={cn('text-muted-foreground', className)}>미점검</Badge>;
}

type Line = { unitId: string; key: string; groupId: string; speaker: string | null; source: string; translation: string | null };

/**
 * 이음새 점검: a seam of the path view, where this route's new lines hand back
 * into lines of an earlier route. Shows the route's last lines before the seam, a divider, and the
 * first lines of the earlier route after it. Read-only; a line opens in the script view to be
 * changed. The mark is stored with a signature of what was read.
 */
export function SeamCheckPane({ projectId, nodeId, onClose }: { projectId: string; nodeId: string; onClose: () => void }) {
  const detail = useQuery(q.seamDetail(projectId, nodeId));
  const project = useQuery(q.project(projectId));
  const tokens = tokenPatternOf(project.data?.formatRules ?? undefined);
  const data = detail.data;
  const mark = useMutation({
    mutationFn: (sig: string) => unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$put({ param: { projectId, nodeId }, json: { sig } })),
    onError: (error) => toast.error(error.message),
  });
  const unmark = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['seam-checks'][':nodeId'].$delete({ param: { projectId, nodeId } })),
    onError: (error) => toast.error(error.message),
  });
  useReportView('graph-node', [data && { kind: '이음새', id: nodeId, label: `이음새 점검 · ${(data.after[0]?.source ?? '').slice(0, 40)}` }]);

  const state = data?.check?.state;
  const line = (item: Line) => (
    <li key={item.unitId} className="group flex items-start gap-2 py-2 first:pt-0 last:pb-0" data-testid="seam-line">
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="text-xs text-muted-foreground">{item.speaker ?? '지문·문구'}</p>
        <TokenText text={item.source} source={item.source} pattern={tokens} />
        {item.translation ? <TokenText text={item.translation} source={item.source} pattern={tokens} className="text-muted-foreground" /> : <p className="text-xs text-muted-foreground">번역 없음</p>}
      </div>
      <Button variant="ghost" size="icon-xs" asChild className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: item.groupId, line: item.unitId }} title="번역 화면에서 열기" aria-label="번역 화면에서 열기">
          <FileText />
        </Link>
      </Button>
    </li>
  );
  const lines = (items: Line[], empty: string) =>
    items.length ? <InspectorList>{items.map(line)}</InspectorList> : <p className="text-sm text-muted-foreground">{empty}</p>;

  return (
    <Inspector header={<InspectorHeader kind="경로" name="이음새" status={data && <SeamStateChip state={state} />} onClose={onClose} />} footer={
        data ? (
          <>
            {state === 'stale' && (
              <Button variant="outline" disabled={unmark.isPending} onClick={() => unmark.mutate()}>
                점검 취소
              </Button>
            )}
            <Button disabled={mark.isPending || unmark.isPending} onClick={() => (state === 'checked' ? unmark.mutate() : mark.mutate(data.sig))}>
              {state === 'checked' ? '점검 취소' : '점검함'}
            </Button>
          </>
        ) : undefined
      } loading={detail.isPending}>
      {detail.isError && (
        <InspectorBlock>
          <InspectorResult tone="error">이음새 정보를 불러오지 못했습니다: {detail.error.message}</InspectorResult>
        </InspectorBlock>
      )}
      {data && state === 'stale' && (
        <InspectorBlock>
          <InspectorResult tone="info">점검한 뒤 이 줄들의 번역이 바뀌었습니다.</InspectorResult>
        </InspectorBlock>
      )}
      {data && (
        <div data-testid="seam-route">
          {data.before.map((entry, i) => (
            <InspectorSection key={entry.from} title={data.before.length > 1 ? `이번 길 ${i + 1}/${data.before.length}` : '이번 길'}>
              {lines(entry.lines, '이 갈래에는 이음새 앞 대사가 없습니다.')}
            </InspectorSection>
          ))}
          <InspectorSection title="번역한 길">{lines(data.after, '이음새 뒤에 대사가 없습니다.')}</InspectorSection>
        </div>
      )}
    </Inspector>
  );
}
