import { useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { client, unwrap } from '@/lib/api';
import { useDraft } from '@/lib/drafts';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';

export const Route = createFileRoute('/p/$projectId/reviews')({
  validateSearch: (raw: Record<string, unknown>): { item?: string } => ({ item: typeof raw.item === 'string' ? raw.item : undefined }),
  component: Reviews,
});

/** Lines waiting at a human node. Deciding one moves only that line on; the rest keep waiting. */
function Reviews() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const reviews = useQuery(q.reviews(projectId));
  const list = reviews.data ?? [];
  const current = list.find((item) => item.id === search.item) ?? list[0];
  const index = current ? list.indexOf(current) : -1;
  const [draft, setDraft, clearDraft] = useDraft(`review:${current?.id ?? ''}`, current?.data.candidateText ?? current?.translation ?? '');
  useReportView('review', [current && { kind: '검토 대기 대사', id: current.unitId, label: `${current.key} · ${current.source.slice(0, 40)}` }]);

  const decide = useMutation({
    mutationFn: ({ id, decision, text }: { id: string; decision: 'approved' | 'rejected'; text?: string }) => unwrap(client.reviews[':itemId'].$post({ param: { itemId: id }, json: { decision, text } })),
    onSuccess: (_data, variables) => {
      clearDraft();
      toast.success(variables.decision === 'approved' ? '승인했습니다.' : '반려했습니다.');
      const next = list[index + 1] ?? list[index - 1];
      void navigate({ search: { item: next?.id }, replace: true });
    },
  });

  const original = current?.data.candidateText ?? current?.translation ?? '';
  const edited = draft !== original;
  const approve = () => current && decide.mutate({ id: current.id, decision: 'approved', text: edited ? draft : undefined });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        approve();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (reviews.data && !list.length)
    return (
      <Page title="검토함">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>검토할 대사가 없습니다</EmptyTitle>
            <EmptyDescription>워크플로의 ‘사람 확인’ 노드에 도착한 대사가 여기에 모입니다.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );

  return (
    <Page title="검토함" description={`사람 확인을 기다리는 대사 ${list.length}개`} flush className="border-t-0">
      <div className="flex h-full min-h-0 border-t">
        <ul className="w-80 shrink-0 overflow-auto border-r">
          {list.map((item) => (
            <li key={item.id}>
              <button onClick={() => void navigate({ search: { item: item.id }, replace: true })} className={cn('w-full border-b px-4 py-2.5 text-left hover:bg-muted/50', item.id === current?.id && 'bg-muted')}>
                <p className="truncate text-xs text-muted-foreground">
                  {item.groupTitle} · {item.key}
                </p>
                <p className="truncate text-sm">{item.source}</p>
                {item.data.review && !item.data.review.passed && <p className="truncate text-xs text-amber-700">{item.data.review.issues[0]}</p>}
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div className="min-w-0 flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Link to="/p/$projectId/scenes/$groupId" params={{ projectId, groupId: current.groupId }} search={{ line: current.unitId }} className="hover:underline">
                  {current.groupTitle}
                </Link>
                · <span className="font-mono text-xs">{current.key}</span>
                <Badge variant="outline" className="ml-auto">
                  <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: current.runId }}>
                    {current.workflowName} · {current.nodeLabel}
                  </Link>
                </Badge>
              </div>
              {current.instructions && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{current.instructions}</p>}
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">원문{current.speaker ? ` · ${current.speaker}` : ''}</h3>
                <p className="text-base whitespace-pre-wrap">{current.source}</p>
              </section>
              {(current.data.review || current.data.check) && (
                <section className="space-y-1 rounded-md border p-3 text-sm">
                  {current.data.check && !current.data.check.passed && <p className="text-amber-700">형식 검사: {current.data.check.issues.join(', ')}</p>}
                  {current.data.review &&
                    (current.data.review.passed ? (
                      <p className="text-emerald-700">마지막 검수 통과</p>
                    ) : (
                      <ul className="list-disc pl-5 text-amber-800">
                        {current.data.review.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    ))}
                </section>
              )}
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">번역 (고치면 사람 후보로 저장 후 승인)</h3>
                <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-28 text-base" />
              </section>
              <div className="flex items-center gap-2">
                <Button onClick={approve} disabled={decide.isPending}>
                  <Check /> {edited ? '수정해서 승인' : '승인'} <Kbd className="ml-1">⌘↵</Kbd>
                </Button>
                <Button variant="outline" onClick={() => decide.mutate({ id: current.id, decision: 'rejected' })} disabled={decide.isPending}>
                  <X /> 반려
                </Button>
                {edited && (
                  <Button variant="ghost" onClick={clearDraft}>
                    원래대로
                  </Button>
                )}
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {index + 1} / {list.length}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
