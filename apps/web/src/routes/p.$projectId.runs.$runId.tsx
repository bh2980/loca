import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, OctagonAlert, Pause, Play, CircleStop } from 'lucide-react';
import { runNodeName, type WorkflowNode } from '@tw/shared';
import { ContextItemList } from '@/components/ai-context';
import { LineDetail } from '@/components/line-detail';
import { TermEditor } from '@/components/glossary/term-pane';
import { HeaderActions, Page } from '@/components/page';
import { EmptyState, SectionHeading, DataTable, type ColumnDef, Pager, FilterBar, ActionBar, Separator, SplitPane, JobStatusBadge, StatusBarItem, Alert, AlertDescription, AlertTitle, Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Progress, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Tabs, TabsList, TabsTrigger, Skeleton } from '@loca/ui';
import { HeaderFilter } from '@/components/header-filter';
import { client, unwrap } from '@/lib/api';
import { ITEM_STATE } from '@/lib/labels';
import { errorKindLabel, retryReason, retryState } from '@/lib/retry-info';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import type { InferResponseType } from 'hono/client';
import { BatchList } from '@/components/workflow/batch-list';
import { ContinueRun } from '@/components/workflow/continue-run';
import { RaiseCaps } from '@/components/workflow/raise-caps';
import { RunGraph } from '@/components/workflow/run-graph';
import { topCallIds } from '@/components/workflow/run-calls';
import { dateTime } from '@/lib/datetime';

type State = keyof typeof ITEM_STATE | 'retrying';
interface RunSearch {
  state?: State;
  node?: string;
  page?: number;
  line?: string;
  tab?: 'steps' | 'plan' | 'graph';
  aiNode?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/$runId')({
  validateSearch: (raw: Record<string, unknown>): RunSearch => ({
    state: typeof raw.state === 'string' && (raw.state in ITEM_STATE || raw.state === 'retrying') ? (raw.state as State) : undefined,
    node: typeof raw.node === 'string' ? raw.node : undefined,
    page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
    line: typeof raw.line === 'string' ? raw.line : undefined,
    tab: raw.tab === 'steps' || raw.tab === 'plan' || raw.tab === 'graph' ? raw.tab : undefined,
    aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
  }),
  component: RunDetail,
});

const PAGE = 100;

type Item = InferResponseType<(typeof client.runs)[':id']['items']['$get'], 200>['rows'][number];

function RunDetail() {
  const [continueOpen, setContinueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { projectId, runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const run = useQuery(q.run(runId));
  const items = useQuery(q.runItems(runId, { state: search.state, nodeId: search.node, offset: (search.page ?? 0) * PAGE }));
  const terms = items.data?.subject === 'terms';
  const termList = useQuery({ ...q.terms(projectId), enabled: terms && Boolean(search.line) });
  const selectedTerm = terms ? termList.data?.find((term) => term.id === search.line) : undefined;
  const decide = useMutation({
    mutationFn: (accept: boolean) => unwrap(client.projects[':projectId'].drafts.$post({ param: { projectId }, json: { kind: 'terms', ids: [search.line!], action: accept ? 'confirm' : 'discard' } })),
    onError: (error) => toast.error(error.message),
  });
  const steps = useQuery({ ...q.runSteps(runId), enabled: search.tab === 'steps' });
  const plan = useQuery({ ...q.runPlan(runId), enabled: search.tab === 'plan' });
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'cancel') => unwrap(client.runs[':id'][':action{pause|resume|cancel}'].$post({ param: { id: runId, action } })) });
  const setSearch = (next: Partial<RunSearch>, replace = false) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });
  useReportView('run', [run.data && { kind: '실행', id: run.data.id, label: run.data.workflowName }]);

  if (!run.data)
    return (
      <Page title="실행" flush>
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      </Page>
    );
  const data = run.data;
  const view = search.tab ?? 'items';
  const nodeById = new Map<string, WorkflowNode>(data.definition.nodes.map((node) => [node.id, node]));
  const totals = data.nodes.reduce<Record<string, number>>((acc, row) => ((acc[row.state] = (acc[row.state] ?? 0) + row.count), acc), {});
  const nodeTotals = data.nodes.reduce<Record<string, number>>((acc, row) => ((acc[row.nodeId] = (acc[row.nodeId] ?? 0) + row.count), acc), {});
  const retryingTotal = Object.values(data.retrying).reduce((sum, entry) => sum + entry.count, 0);
  const finished = (totals.done ?? 0) + (totals.failed ?? 0) + (totals.cancelled ?? 0);
  const order = data.definition.nodes.filter((node) => nodeTotals[node.id]);
  // A node inside a called workflow reads "호출 이름 › 노드 이름".
  const nodeName = (id: string) => {
    const node = nodeById.get(id);
    return node ? runNodeName(data.definition, node) : (data.definition.calls?.[id]?.name ?? id);
  };
  // 위치 filter: each call as a whole (the run graph's call card opens it), then its nodes.
  const callIds = topCallIds(data.definition);
  const locations = order.flatMap((node) => {
    const call = callIds.find((id) => node.id.startsWith(`${id}/`));
    const first = call && order.find((other) => other.id.startsWith(`${call}/`)) === node;
    return [
      ...(call && first ? [{ value: call, label: `${nodeName(call)} (전체)`, hint: order.filter((other) => other.id.startsWith(`${call}/`)).reduce((sum, other) => sum + nodeTotals[other.id]!, 0) }] : []),
      { value: node.id, label: nodeName(node.id), hint: nodeTotals[node.id] },
    ];
  });
  const active = data.status === 'running' || data.status === 'paused';
  const total = items.data?.total ?? 0;
  const filtered = Boolean(search.state || search.node);

  const columns: ColumnDef<Item, unknown>[] = [
    ...(terms ? [] : [{ id: 'speaker', header: '화자', meta: { width: 112 }, cell: ({ row }) => row.original.speaker ?? '—' } satisfies ColumnDef<Item, unknown>]),
    { id: 'source', header: '원문', meta: { wrap: true, hideable: false }, cell: ({ row }) => row.original.source },
    ...(terms ? [{ id: 'target', header: '현재 표기', meta: { wrap: true }, cell: ({ row }) => row.original.target || '—' } satisfies ColumnDef<Item, unknown>] : []),
    { id: 'candidate', header: '최신 후보', meta: { wrap: true, className: 'text-muted-foreground' }, cell: ({ row }) => row.original.data.candidateText ?? '—' },
    {
      id: 'node',
      header: () => (
        <HeaderFilter
          label="위치"
          value={search.node}
          onChange={(node) => setSearch({ node, page: undefined, line: undefined }, true)}
          options={locations}
        />
      ),
      meta: { width: 160, label: '위치' },
      cell: ({ row }) => nodeName(row.original.nodeId),
    },
    {
      id: 'state',
      header: () => (
        <HeaderFilter
          label="상태"
          value={search.state}
          onChange={(state) => setSearch({ state: state as State | undefined, page: undefined, line: undefined }, true)}
          options={[
            ...(Object.keys(ITEM_STATE) as (keyof typeof ITEM_STATE)[]).filter((state) => totals[state]).map((state) => ({ value: state, label: ITEM_STATE[state], hint: totals[state] })),
            ...(retryingTotal || search.state === 'retrying' ? [{ value: 'retrying', label: '다시 보내는 중', hint: retryingTotal }] : []),
          ]}
        />
      ),
      meta: { width: 128, label: '상태' },
      cell: ({ row }) => (
        <>
          {row.original.retry ? <span className="text-xs">{retryState(row.original.retry.times, row.original.retry.max)}</span> : ITEM_STATE[row.original.state]}
          {row.original.state === 'done' && row.original.statusName && <span className="text-muted-foreground"> → {row.original.statusName}</span>}
          {Object.values(row.original.visits).some((count) => count > 1) && <span className="text-xs text-muted-foreground"> · 재방문 {Math.max(...Object.values(row.original.visits)) - 1}</span>}
        </>
      ),
    },
    {
      id: 'verdict',
      header: '결과',
      meta: { width: 220, wrap: true, className: 'text-xs' },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <>
            {item.retry && <p className="text-muted-foreground" title={item.retry.message}>{retryReason(item.retry)}</p>}
            {item.error && <p className="text-destructive">{item.error}</p>}
            {!!item.data.issues?.length && <p className="text-warning">{item.data.issues.join(' / ')}</p>}
            {!!item.data.notes?.length && <p className="text-muted-foreground">{item.data.notes.join(' / ')}</p>}
            {Object.entries(item.data.outputs ?? {})
              .filter(([, output]) => typeof output.passed === 'boolean')
              .map(([nodeId, output]) => (
                <p key={nodeId} className={output.passed ? 'text-success' : 'text-warning'}>
                  {nodeName(nodeId)} {output.passed ? '통과' : '실패'}
                </p>
              ))}
            {Object.entries(item.data.outputs ?? {})
              .filter(([, output]) => 'confidence' in output && 'value' in output)
              .map(([nodeId, output]) => (
                <p key={`choice:${nodeId}`} className="text-muted-foreground">
                  {nodeName(nodeId)}: {output.value == null ? '해당 없음' : String(output.value)} (확신도 {Number(output.confidence).toFixed(2)})
                </p>
              ))}
          </>
        );
      },
    },
  ];

  const stop = (
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>실행을 취소할까요?</AlertDialogTitle>
          <AlertDialogDescription>아직 처리하지 않은 {data.subject === 'terms' ? '용어' : '대사'}는 이 실행에서 빠집니다. 이미 반영된 번역·상태는 그대로입니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>계속 실행</AlertDialogCancel>
          <AlertDialogAction onClick={() => control.mutate('cancel')}>실행 취소</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <Page title={data.workflowName} flush back={<Button variant="ghost" asChild><Link to="/p/$projectId/runs" params={{ projectId }}><ChevronLeft /> 실행 기록</Link></Button>}>
      <SplitPane
        id="run-lines" selectionKey={search.line}
        defaultWidth="400px"
        className="h-full min-h-0"
        pane={
          search.line && (terms ? (
            selectedTerm ? (
              <TermEditor key={selectedTerm.id} projectId={projectId} term={selectedTerm} onClose={() => setSearch({ line: undefined }, true)} onDecide={(accept) => decide.mutate(accept)} deciding={decide.isPending} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">{termList.isSuccess ? '용어집에서 사라진 용어입니다.' : '용어를 불러오는 중…'}</p>
            )
          ) : (
            <LineDetail
              projectId={projectId}
              unitId={search.line}
              onClose={() => setSearch({ line: undefined }, true)}
              showScene
              editor
              aiNode={search.aiNode}
              onAiNode={(aiNode) => setSearch({ aiNode }, true)}
            />
          ))
        }
      >
        <HeaderActions>
          <Tabs value={view} onValueChange={(value) => setSearch({ tab: value === 'steps' || value === 'plan' || value === 'graph' ? value : undefined }, true)} className="self-stretch">
            <TabsList variant="line" className="h-full border-b-0" aria-label="보기">
              <TabsTrigger value="items">{terms ? '용어별' : '대사별'}</TabsTrigger>
              <TabsTrigger value="graph">그래프</TabsTrigger>
              <TabsTrigger value="steps">AI 호출</TabsTrigger>
              {/* Terms are not planned in scene batches: there is no plan to show. */}
              {data.subject !== 'terms' && <TabsTrigger value="plan">번역 계획</TabsTrigger>}
            </TabsList>
          </Tabs>
          <Separator orientation="vertical" className="mx-1 h-4" />
          {data.status === 'running' && <Button onClick={() => control.mutate('pause')}><Pause /> 일시정지</Button>}
          {data.status === 'paused' && <Button variant={data.limits?.hit ? 'outline' : 'default'} onClick={() => control.mutate('resume')}><Play /> 재개</Button>}
          {data.status === 'completed' && (totals.failed ?? 0) > 0 && !data.filling && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused={false} />}
          {(active || data.status === 'paused') && <ActionBar aria-label="실행 동작" items={[
            ...(active ? [{ id: 'cancel', label: '실행 취소', icon: <CircleStop />, destructive: true, onSelect: () => setCancelOpen(true) }] : []),
            ...(data.status === 'paused' && !data.filling ? [{ id: 'continue', label: '모델 바꿔 재개', icon: <Play />, onSelect: () => setContinueOpen(true) }] : []),
          ]} />}
        </HeaderActions>
        {data.status === 'paused' && !data.filling && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused hideTrigger open={continueOpen} onOpenChange={setContinueOpen} />}
        {active && stop}
        <StatusBarItem><JobStatusBadge status={data.status} /></StatusBarItem>
        {view === 'items' && <FilterBar end={items.data ? <span className="text-2xs tabular-nums">{total.toLocaleString()}{terms ? '개' : '줄'}</span> : undefined}>
          {filtered && (
            <Button variant="ghost" onClick={() => setSearch({ state: undefined, node: undefined, page: undefined, line: undefined }, true)}>
              필터 지우기
            </Button>
          )}
        </FilterBar>}

        <div className="shrink-0 space-y-3 border-b px-4 py-3">
          {data.status === 'paused' && data.notice && (
            <Alert variant="destructive">
              <OctagonAlert />
              <AlertTitle>실행이 멈췄습니다</AlertTitle>
              <AlertDescription>{data.notice}</AlertDescription>
              {data.limits?.hit && !data.filling && <RaiseCaps key={`${data.limits.maxCalls}-${data.limits.maxInputTokens}`} runId={runId} limits={data.limits} />}
            </Alert>
          )}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="shrink-0">실행 ID</span>
            <code className="truncate font-mono">{runId}</code>
            <CopyButton value={runId} label="실행 ID 복사" />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {dateTime(data.createdAt)} 시작 · 모델 {data.models.map((model) => model.label).join(', ') || '없음'}
          </p>
          {data.byModel.length > 1 && (
            <p className="text-xs text-muted-foreground">
              연결별 호출: {data.byModel.map((row) => `${[row.name, row.model].filter(Boolean).join(' · ') || '알 수 없음'} ${row.steps}회${row.failed ? `(실패 ${row.failed})` : ''}`).join(', ')}
            </p>
          )}
          {data.continuations.map((entry, index) => (
            <p key={index} className="text-xs text-muted-foreground">
              {dateTime(entry.at)} 이어서 실행{entry.changes.length > 0 && ` · ${entry.changes.map((change) => `${nodeName(change.nodeId)}: ${change.from} → ${change.to}`).join(', ')}`}
              {entry.retried > 0 && ` · 실패한 줄 ${entry.retried.toLocaleString()}개 다시`}
            </p>
          ))}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span>
                <b className="tabular-nums">{finished.toLocaleString()}</b>
                <span className="text-muted-foreground tabular-nums"> / {data.total.toLocaleString()} {terms ? '용어' : '대사'} 처리 · {data.total ? Math.round((finished / data.total) * 100) : 0}%</span>
              </span>
              {data.usage && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  AI 호출 {data.usage.steps} · 실패 {data.usage.failed ?? 0} · 입력 {data.usage.inputTokens.toLocaleString()}
                  {data.usage.cachedInputTokens > 0 && ` (캐시 ${data.usage.cachedInputTokens.toLocaleString()})`} · 출력 {data.usage.outputTokens.toLocaleString()}
                  {data.usage.costUsd != null && ` · 보고된 비용 $${data.usage.costUsd.toFixed(4)}`}
                  {data.limits?.maxCalls != null && ` · 호출 상한 ${data.limits.maxCalls.toLocaleString()}회`}
                  {data.limits?.maxInputTokens != null && ` · 입력 상한 ${data.limits.maxInputTokens.toLocaleString()}`}
                </span>
              )}
            </div>
            <Progress value={data.total ? (finished / data.total) * 100 : 0} className="h-1.5" />
          </div>
        </div>

        {view === 'items' ? (
          <DataTable id="run-items"
            columns={columns}
            rows={items.data?.rows}
            rowId={(item) => item.id}
            loading={!items.data}
            selected={items.data?.rows.find((item) => item.unitId === search.line)?.id}
            onRowClick={(item) => setSearch({ line: search.line === item.unitId ? undefined : item.unitId }, true)}
            empty={<EmptyState noun={terms ? '용어' : '대사'} filtered={filtered} />}
            footer={<Pager page={search.page ?? 0} total={total} pageSize={PAGE} onPage={(page) => setSearch({ page: page || undefined })} />}
          />
        ) : view === 'graph' ? (
          <div className="min-h-0 flex-1">
            <RunGraph projectId={projectId} run={data} selected={search.node} onOpenNode={(node) => setSearch({ tab: undefined, node, state: undefined, page: undefined, line: undefined })} />
          </div>
        ) : view === 'plan' ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {plan.data ? (
              plan.data.total ? (
                <>
                  <SectionHeading className="mb-3">번역 계획</SectionHeading>
                  <BatchList list={plan.data} defaultOpen />
                </>
              ) : (
                <EmptyState noun="저장된 번역 계획" />
              )
            ) : plan.isError ? (
              <p className="py-12 text-center text-sm text-destructive">번역 계획을 불러오지 못했습니다: {plan.error.message}</p>
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {!steps.data ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <ul>
                {steps.data.map((step) => (
                  <li key={step.id} className="px-4 py-2 text-sm">
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="group w-full justify-start font-normal">
                          <ChevronRight className="text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                          {/* The spaces keep the row's words apart when read or copied (#48); the flex gap already spaces them on screen. */}
                          <span className="w-32 truncate text-left font-medium">{nodeName(step.nodeId)}</span>{' '}
                          <Badge variant={step.ok ? 'outline' : 'destructive'}>{step.ok ? '성공' : '실패'}</Badge>{' '}
                          {!step.ok && errorKindLabel(step.errorKind) && <Badge variant="outline">{errorKindLabel(step.errorKind)}</Badge>}{' '}
                          <span className="text-muted-foreground">{terms ? `용어 ${step.subjectIds.length}개` : `대사 ${step.subjectIds.length}줄`}</span>{' '}
                          <span className="min-w-0 truncate text-muted-foreground">{[data.models.find((model) => model.connectionId === step.connectionId)?.name, step.model].filter(Boolean).join(' · ')}</span>
                          {' '}
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s
                            {step.inputTokens != null && ` · 입력 ${step.inputTokens.toLocaleString()}${step.cachedInputTokens ? `(캐시 ${step.cachedInputTokens.toLocaleString()})` : ''} · 출력 ${(step.outputTokens ?? 0).toLocaleString()}`}
                            {step.costUsd != null && ` · $${step.costUsd.toFixed(4)}`}
                          </span>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2 pl-9">
                        {step.error && <p className="text-destructive">{[errorKindLabel(step.errorKind), step.error].filter(Boolean).join(' · ')}</p>}
                        {Array.isArray(step.context) && (
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" className="group font-normal text-muted-foreground">
                                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                                넣은 문맥 {step.context.filter((item) => item.included).length}개
                                {step.context.some((item) => !item.included) && ` · 상한 초과 ${step.context.filter((item) => !item.included).length}`}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-2">
                                <ContextItemList items={step.context} />
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        {step.prompt && (
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" className="group font-normal text-muted-foreground">
                                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                                보낸 프롬프트
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{step.prompt}</pre>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        {step.output != null && (
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" className="group font-normal text-muted-foreground">
                                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                                응답
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(step.output, null, 2)}</pre>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                ))}
                {steps.data.length === 0 && <li className="px-4 py-6 text-sm text-muted-foreground">아직 AI 호출이 없습니다.</li>}
              </ul>
            )}
          </div>
        )}
      </SplitPane>
      {data.workflowId && (
        <p className="sr-only">
          <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: data.workflowId }}>
            워크플로 열기
          </Link>
        </p>
      )}
    </Page>
  );
}
