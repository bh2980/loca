import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, OctagonAlert, Pause, Play, CircleStop } from 'lucide-react';
import { nodeName as nameOf, type WorkflowNode } from '@tw/shared';
import { ContextItemList } from '@/components/ai-context';
import { LineDetail } from '@/components/line-detail';
import { HeaderActions, Page } from '@/components/page';
import { EmptyState, DataTable, type ColumnDef, Pager, FilterBar, ActionBar, Separator, SplitPane, JobStatusBadge, StatusBarItem, Alert, AlertDescription, AlertTitle, Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Progress, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Tabs, TabsList, TabsTrigger, Skeleton, HelpTip } from '@loca/ui';
import { HeaderFilter } from '@/components/header-filter';
import { client, unwrap } from '@/lib/api';
import { ITEM_STATE } from '@/lib/labels';
import { q } from '@/lib/queries';
import { useReportView } from '@/lib/view-context';
import type { InferResponseType } from 'hono/client';
import { BatchList } from '@/components/workflow/batch-list';
import { ContinueRun } from '@/components/workflow/continue-run';
import { dateTime } from '@/lib/datetime';

type State = keyof typeof ITEM_STATE;
interface RunSearch {
  state?: State;
  node?: string;
  page?: number;
  line?: string;
  tab?: 'steps' | 'plan';
  lineTab?: 'candidates' | 'checks' | 'terms' | 'history';
  aiNode?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/$runId')({
  validateSearch: (raw: Record<string, unknown>): RunSearch => ({
    state: typeof raw.state === 'string' && raw.state in ITEM_STATE ? (raw.state as State) : undefined,
    node: typeof raw.node === 'string' ? raw.node : undefined,
    page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
    line: typeof raw.line === 'string' ? raw.line : undefined,
    tab: raw.tab === 'steps' || raw.tab === 'plan' ? raw.tab : undefined,
    lineTab: raw.lineTab === 'checks' || raw.lineTab === 'candidates' || raw.lineTab === 'terms' || raw.lineTab === 'history' ? raw.lineTab : undefined,
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
  const finished = (totals.done ?? 0) + (totals.failed ?? 0) + (totals.cancelled ?? 0);
  const order = data.definition.nodes.filter((node) => nodeTotals[node.id]);
  const nodeName = (id: string) => {
    const node = nodeById.get(id);
    return node ? nameOf(node) : id;
  };
  const active = data.status === 'running' || data.status === 'paused';
  const total = items.data?.total ?? 0;
  const filtered = Boolean(search.state || search.node);

  const columns: ColumnDef<Item, unknown>[] = [
    { id: 'speaker', header: '화자', meta: { width: 112 }, cell: ({ row }) => row.original.speaker ?? '—' },
    { id: 'source', header: '원문', meta: { wrap: true, hideable: false }, cell: ({ row }) => row.original.source },
    { id: 'candidate', header: '최신 후보', meta: { wrap: true, className: 'text-muted-foreground' }, cell: ({ row }) => row.original.data.candidateText ?? '—' },
    {
      id: 'node',
      header: () => (
        <HeaderFilter
          label="위치"
          value={search.node}
          onChange={(node) => setSearch({ node, page: undefined, line: undefined }, true)}
          options={order.map((node) => ({ value: node.id, label: nameOf(node), hint: nodeTotals[node.id] }))}
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
          options={(Object.keys(ITEM_STATE) as State[]).filter((state) => totals[state]).map((state) => ({ value: state, label: ITEM_STATE[state], hint: totals[state] }))}
        />
      ),
      meta: { width: 128, label: '상태' },
      cell: ({ row }) => (
        <>
          {ITEM_STATE[row.original.state]}
          {row.original.state === 'done' && row.original.statusName && <span className="text-muted-foreground"> → {row.original.statusName}</span>}
          {Object.values(row.original.visits).some((count) => count > 1) && <span className="text-xs text-muted-foreground"> · 재방문 {Math.max(...Object.values(row.original.visits)) - 1}</span>}
        </>
      ),
    },
    {
      id: 'verdict',
      header: '판정·지적·오류',
      meta: { width: 220, wrap: true, className: 'text-xs' },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <>
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
          <AlertDialogDescription>아직 처리하지 않은 대사는 이 실행에서 빠집니다. 이미 반영된 번역·상태는 그대로이고, 다시 실행하면 남은 대사를 처리할 수 있습니다.</AlertDialogDescription>
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
        id="run-lines"
        defaultWidth="400px"
        className="h-full min-h-0"
        pane={
          search.line && (
            <LineDetail
              projectId={projectId}
              unitId={search.line}
              onClose={() => setSearch({ line: undefined }, true)}
              showScene
              editor
              tab={search.lineTab ?? 'context'}
              onTab={(tab) => setSearch({ lineTab: tab === 'context' ? undefined : tab }, true)}
              aiNode={search.aiNode}
              onAiNode={(aiNode) => setSearch({ aiNode }, true)}
            />
          )
        }
      >
        <HeaderActions>
          <Tabs value={view} onValueChange={(value) => setSearch({ tab: value === 'steps' || value === 'plan' ? value : undefined }, true)} className="self-stretch">
            <TabsList variant="line" className="h-full border-b-0" aria-label="보기">
              <TabsTrigger value="items">대사별</TabsTrigger>
              <TabsTrigger value="steps">AI 호출</TabsTrigger>
              <TabsTrigger value="plan">번역 계획</TabsTrigger>
            </TabsList>
          </Tabs>
          <Separator orientation="vertical" className="mx-1 h-4" />
          {data.status === 'running' && <Button onClick={() => control.mutate('pause')}><Pause /> 일시정지</Button>}
          {data.status === 'paused' && <Button onClick={() => control.mutate('resume')}><Play /> 재개</Button>}
          {data.status === 'completed' && (totals.failed ?? 0) > 0 && !data.filling && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused={false} />}
          {(active || data.status === 'paused') && <ActionBar aria-label="실행 동작" items={[
            ...(active ? [{ id: 'cancel', label: '실행 취소', icon: <CircleStop />, destructive: true, onSelect: () => setCancelOpen(true) }] : []),
            ...(data.status === 'paused' && !data.filling ? [{ id: 'continue', label: '모델 바꿔 재개', icon: <Play />, onSelect: () => setContinueOpen(true) }] : []),
          ]} />}
        </HeaderActions>
        {data.status === 'paused' && !data.filling && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused hideTrigger open={continueOpen} onOpenChange={setContinueOpen} />}
        {active && stop}
        <StatusBarItem><JobStatusBadge status={data.status} /></StatusBarItem>
        <FilterBar end={view === 'items' && items.data ? <span className="text-2xs tabular-nums">{total.toLocaleString()}줄</span> : undefined}>
          {filtered && view === 'items' && (
            <Button variant="ghost" onClick={() => setSearch({ state: undefined, node: undefined, page: undefined, line: undefined }, true)}>
              필터 지우기
            </Button>
          )}
        </FilterBar>

        <div className="shrink-0 space-y-3 border-b px-4 py-3">
          {data.status === 'paused' && data.notice && (
            <Alert variant="destructive">
              <OctagonAlert />
              <AlertTitle>실행이 멈췄습니다</AlertTitle>
              <AlertDescription>{data.notice} 원인을 확인한 뒤 위의 재개 버튼으로 이어서 실행할 수 있습니다.</AlertDescription>
            </Alert>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {dateTime(data.createdAt)} 시작 · 모델 {data.models.map((model) => (model.routes.length > 1 ? `${model.label} (막히면 → ${model.routes.slice(1).map((route) => `${route.name} · ${route.model}`).join(' → ')})` : model.label)).join(', ') || '없음'}
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
                <span className="text-muted-foreground tabular-nums"> / {data.total.toLocaleString()} 대사 처리 · {data.total ? Math.round((finished / data.total) * 100) : 0}%</span>
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
            empty={<EmptyState noun="대사" filtered={filtered} />}
            footer={<Pager page={search.page ?? 0} total={total} pageSize={PAGE} onPage={(page) => setSearch({ page: page || undefined })} />}
          />
        ) : view === 'plan' ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {plan.data ? (
              plan.data.total ? (
                <>
                  <p className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">번역 계획 <HelpTip>실행을 시작할 때 짠 묶음입니다. 모든 AI 단계(번역·검수·수정)가 이 묶음 단위로 움직입니다.</HelpTip></p>
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
                          <span className="text-muted-foreground">대사 {step.unitIds.length}</span>{' '}
                          <span className="min-w-0 truncate text-muted-foreground">{[data.models.flatMap((model) => model.routes).find((route) => route.connectionId === step.connectionId)?.name, step.model].filter(Boolean).join(' · ')}</span>
                          {' '}
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s
                            {step.inputTokens != null && ` · 입력 ${step.inputTokens.toLocaleString()}${step.cachedInputTokens ? `(캐시 ${step.cachedInputTokens.toLocaleString()})` : ''} · 출력 ${(step.outputTokens ?? 0).toLocaleString()}`}
                            {step.costUsd != null && ` · $${step.costUsd.toFixed(4)}`}
                          </span>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2 pl-9">
                        {step.error && <p className="text-destructive">{step.error}</p>}
                        {Array.isArray(step.attempts) && step.attempts.length > 1 && (
                          <p className="text-xs text-muted-foreground">시도: {(step.attempts as { model: string; ok: boolean; error?: string }[]).map((attempt) => `${attempt.model} ${attempt.ok ? '성공' : `실패(${attempt.error})`}`).join(' → ')}</p>
                        )}
                        {Array.isArray(step.context) && (
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" className="group font-normal text-muted-foreground">
                                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                                넣은 문맥 {step.context.filter((item) => item.included).length}개
                                {step.context.some((item) => !item.included) && ` · 상한 초과로 뺀 것 ${step.context.filter((item) => !item.included).length}개`}
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
                                보낸 프롬프트(문맥 포함)
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
