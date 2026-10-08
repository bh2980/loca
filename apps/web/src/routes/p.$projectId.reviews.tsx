import { useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Inbox } from 'lucide-react';
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
    mutationFn: ({ id, decision, text }: { id: string; decision: string; text?: string; label: string }) => unwrap(client.reviews[':itemId'].$post({ param: { itemId: id }, json: { decision, text } })),
    onSuccess: (_data, variables) => {
      clearDraft();
      toast.success(`‘${variables.label}’(으)로 보냈습니다.`);
      const next = list[index + 1] ?? list[index - 1];
      void navigate({ search: { item: next?.id }, replace: true });
    },
  });

  const original = current?.data.candidateText ?? current?.translation ?? '';
  const edited = draft !== original;
  // Any decision carries the edited text: it is stored as a human candidate before the line moves on.
  const choose = (decision: { id: string; label: string }) => current && decide.mutate({ id: current.id, decision: decision.id, label: decision.label, text: edited ? draft : undefined });
  const approve = () => current?.decisions[0] && choose(current.decisions[0]);

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
            <EmptyDescription>
              워크플로가 ‘사람 확인’ 노드에 도착한 대사만 여기에 모입니다. 상태를 ‘사람 확인 필요’로 바꾸는 것만으로는 오지 않습니다. 그런 대사를 검토하려면 ‘사람 검토’ 워크플로를 실행하세요.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );

  return (
    <Page title="검토함" meta={`사람 확인을 기다리는 대사 ${list.length}개`} flush>
      <div className="flex h-full min-h-0 border-t">
        <ul className="w-80 shrink-0 overflow-auto border-r">
          {list.map((item) => (
            <li key={item.id}>
              <button onClick={() => void navigate({ search: { item: item.id }, replace: true })} className={cn('w-full border-b px-4 py-2.5 text-left hover:bg-muted/50', item.id === current?.id && 'bg-muted')}>
                <p className="truncate text-xs text-muted-foreground">
                  {item.groupTitle} · {item.key}
                </p>
                <p className="truncate text-sm">{item.source}</p>
                {!!item.data.issues?.length && <p className="truncate text-xs text-amber-700">{item.data.issues[0]}</p>}
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div className="min-w-0 flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: current.groupId, line: current.unitId }} className="hover:underline">
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
              {!!current.data.issues?.length && (
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">앞 단계에서 지적된 문제</h3>
                  <ul className="list-disc pl-5 text-amber-800">
                    {current.data.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">번역 (고치면 사람 후보로 저장한 뒤 고른 결정으로 넘어갑니다)</h3>
                <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-28 text-base" />
              </section>
              <div className="flex items-center gap-2">
                {current.decisions.map((decision, i) => (
                  <Button key={decision.id} variant={i === 0 ? 'default' : 'outline'} onClick={() => choose(decision)} disabled={decide.isPending}>
                    {i === 0 && <Check />} {edited ? `수정해서 ${decision.label}` : decision.label}
                    {i === 0 && <Kbd className="ml-1">⌘↵</Kbd>}
                  </Button>
                ))}
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
