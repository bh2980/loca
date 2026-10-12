import { useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { LineChecks } from '@/components/line-detail';
import { Page } from '@/components/page';
import { StatusBadge, StatusDot } from '@/components/status';
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

const ORIGIN = { ai: 'AI', human: '사람', import: '가져옴', tool: '도구' } as const;

/**
 * Every line whose status has "show in review inbox" on, however it got there. The decision is
 * simply the next status (the project's own statuses); an edited translation is saved first.
 */
function Reviews() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const reviews = useQuery(q.reviews(projectId));
  const statuses = useQuery(q.statuses(projectId));
  const list = reviews.data?.rows ?? [];
  const current = list.find((item) => item.id === search.item) ?? list[0];
  const index = current ? list.indexOf(current) : -1;

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
              상태·태그 설정에서 ‘검토함에 표시’를 켠 상태(예: 사람 확인 필요)의 대사가 여기에 모입니다. 사람이 바꾸든 워크플로가 바꾸든 그 상태가 되면 나타납니다.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    );

  return (
    <Page title="검토함" meta={`검토할 대사 ${reviews.data?.total.toLocaleString() ?? '…'}개${(reviews.data?.total ?? 0) > list.length ? ` (앞 ${list.length}개 표시)` : ''}`} flush>
      <div className="flex h-full min-h-0 border-t">
        <ul className="w-80 shrink-0 overflow-auto border-r">
          {list.map((item) => (
            <li key={item.id}>
              <button onClick={() => void navigate({ search: { item: item.id }, replace: true })} className={cn('w-full border-b px-4 py-2.5 text-left hover:bg-muted/50', item.id === current?.id && 'bg-muted')}>
                <p className="truncate text-xs text-muted-foreground">
                  {item.groupTitle} · {item.key}
                </p>
                <p className="truncate text-sm">{item.source}</p>
                {!!item.lastRun?.issues.length && <p className="truncate text-xs text-warning">{item.lastRun.issues[0]}</p>}
              </button>
            </li>
          ))}
        </ul>
        {current && statuses.data && (
          <ReviewItem
            key={current.id}
            projectId={projectId}
            item={current}
            position={`${index + 1} / ${list.length}`}
            statuses={statuses.data.statuses}
            onDone={() => {
              const next = list[index + 1] ?? list[index - 1];
              void navigate({ search: { item: next?.id }, replace: true });
            }}
          />
        )}
      </div>
    </Page>
  );
}

type ReviewRow = Awaited<ReturnType<NonNullable<ReturnType<typeof q.reviews>['queryFn']>>>['rows'][number];

function ReviewItem({ projectId, item, position, statuses, onDone }: {
  projectId: string;
  item: ReviewRow;
  position: string;
  statuses: { id: string; name: string; color: string; kind: 'initial' | 'normal' | 'final' }[];
  onDone: () => void;
}) {
  const unit = useQuery(q.unit(item.id));
  const terms = useQuery(q.terms(projectId));
  const project = useQuery(q.project(projectId));
  // The editor starts from the current translation; AI candidates are pulled in on purpose.
  const [draft, setDraft, clearDraft] = useDraft(`line:${item.id}`, item.translation ?? '');
  const edited = draft !== (item.translation ?? '');
  useReportView('review', [{ kind: '대사', id: item.id, label: `${item.key} · ${item.source.slice(0, 40)}` }]);

  const targets = statuses.filter((status) => status.id !== item.statusId);
  const primary = targets.find((status) => status.kind === 'final') ?? targets[0];
  const move = useMutation({
    mutationFn: (statusId: string) => {
      const same = unit.data?.candidates.find((candidate) => candidate.text === draft);
      const translation = edited ? (same ? { candidateId: same.id } : { translation: draft }) : {};
      return unwrap(client.units[':unitId'].$patch({ param: { unitId: item.id }, json: { ...translation, statusId } }));
    },
    onSuccess: (_data, statusId) => {
      clearDraft();
      toast.success(`${edited ? '번역을 저장하고 ' : ''}‘${statuses.find((status) => status.id === statusId)?.name}’(으)로 옮겼습니다.`);
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && primary && !move.isPending) {
        event.preventDefault();
        move.mutate(primary.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const status = statuses.find((candidate) => candidate.id === item.statusId);
  return (
    <div className="min-w-0 flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: item.groupId, line: item.id }} className="hover:underline">
            {item.groupTitle}
          </Link>
          · <span className="font-mono text-xs">{item.key}</span>
          <StatusBadge status={status} />
          {item.lastRun && (
            <Badge variant="outline" className="ml-auto">
              <Link to="/p/$projectId/runs/$runId" params={{ projectId, runId: item.lastRun.runId }}>
                최근 실행 · {item.lastRun.workflowName}
              </Link>
            </Badge>
          )}
        </div>
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">원문{item.speaker ? ` · ${item.speaker}` : ''}</h3>
          <p className="text-base whitespace-pre-wrap">{item.source}</p>
        </section>
        {!!item.lastRun?.issues.length && (
          <section className="rounded-md border p-3 text-sm">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">최근 실행에서 지적된 문제</h3>
            <ul className="list-disc pl-5 text-warning">
              {item.lastRun.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">대표 번역 {edited && <span className="text-foreground">· 고침 (옮길 때 함께 저장)</span>}</h3>
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-28 text-base" placeholder="아직 번역이 없습니다. 아래 후보를 넣거나 직접 쓰세요." />
          {edited && (
            <Button variant="ghost" size="sm" className="mt-1" onClick={clearDraft}>
              원래대로
            </Button>
          )}
        </section>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">다음 상태로 옮기기</p>
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((target) => (
              <Button key={target.id} variant={target.id === primary?.id ? 'default' : 'outline'} disabled={move.isPending} onClick={() => move.mutate(target.id)}>
                <StatusDot color={target.color} /> {target.name}
                {target.id === primary?.id && <Kbd className="ml-1">⌘↵</Kbd>}
              </Button>
            ))}
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">{position}</span>
          </div>
        </div>

        <LineChecks projectId={projectId} source={item.source} text={draft} terms={terms.data ?? []} rules={project.data?.formatRules} speech={unit.data?.speech} />

        {!!unit.data?.candidates.length && (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">후보 {unit.data.candidates.length}개</h3>
            <ul className="space-y-2">
              {unit.data.candidates.map((candidate) => {
                const isCurrent = candidate.text === (item.translation ?? null);
                return (
                  <li key={candidate.id} className={cn('rounded-md border p-2.5 text-sm', isCurrent && 'border-foreground/30 bg-muted/40')}>
                    <p className="whitespace-pre-wrap">{candidate.text}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{ORIGIN[candidate.origin]}</Badge>
                      {candidate.model && <span>{candidate.model}</span>}
                      <span>{new Date(candidate.createdAt).toLocaleString()}</span>
                      {isCurrent ? (
                        <span className="ml-auto font-medium text-foreground">현재 번역</span>
                      ) : (
                        <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" disabled={candidate.text === draft} onClick={() => setDraft(candidate.text)}>
                          {candidate.text === draft ? '편집기에 있음' : '편집기에 넣기'}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
