import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { InspectorHeader, Inspector, Badge, Button, GroupHeading } from '@loca/ui';
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
    <li key={item.unitId} className="group flex items-start gap-2 px-3 py-2" data-testid="seam-line">
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="text-xs text-muted-foreground">{item.speaker ?? '지문·문구'}</p>
        <TokenText text={item.source} source={item.source} pattern={tokens} />
        {item.translation ? <TokenText text={item.translation} source={item.source} pattern={tokens} className="text-muted-foreground" /> : <p className="text-xs text-muted-foreground">번역 없음</p>}
      </div>
      <Button variant="ghost" size="icon-xs" asChild className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
        <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: item.groupId, line: item.unitId }} title="번역 화면에서 열기" aria-label="번역 화면에서 열기">
          <FileText />
        </Link>
      </Button>
    </li>
  );
  const heading = (text: string) => <GroupHeading className="block bg-muted px-3 py-1.5">{text}</GroupHeading>;

  return (
    <Inspector header={<InspectorHeader kind="경로" name="이음새" status={data && <SeamStateChip state={state} />} onClose={onClose} />} footer={
        data ? (
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
        ) : undefined
      } loading={detail.isPending} bodyClassName="space-y-4 p-4">
      {detail.isError && <p className="text-sm text-destructive">이음새 정보를 불러오지 못했습니다: {detail.error.message}</p>}
      {data && (
        <div className="rounded-md border" data-testid="seam-route">
          {data.before.map((entry, i) => (
            <div key={entry.from}>
              {heading(data.before.length > 1 ? `이번 길 ${i + 1}/${data.before.length}` : '이번 길')}
              <ul>{entry.lines.length ? entry.lines.map(line) : <li className="px-3 py-2 text-xs text-muted-foreground">이 갈래에는 이음새 앞 대사가 없습니다.</li>}</ul>
            </div>
          ))}
          <div role="separator" className="flex items-center gap-2 border-y bg-muted px-3 py-1 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            이음새
            <span className="h-px flex-1 bg-border" />
          </div>
          {heading('번역한 길')}
          <ul>{data.after.length ? data.after.map(line) : <li className="px-3 py-2 text-xs text-muted-foreground">이음새 뒤에 대사가 없습니다.</li>}</ul>
        </div>
      )}
    </Inspector>
  );
}
