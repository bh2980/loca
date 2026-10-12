import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, OctagonAlert, Pause, Play, Square } from 'lucide-react';
import { nodeName as nameOf, type WorkflowNode } from '@tw/shared';
import { ContextItemList } from '@/components/ai-context';
import { LineDetail } from '@/components/line-detail';
import { Page } from '@/components/page';
import { nodeIcon } from '@/components/workflow/node-view';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { client, unwrap } from '@/lib/api';
import { ITEM_STATE, RUN_STATUS } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useReportView } from '@/lib/view-context';
import { SplitPane } from '@/components/split-pane';

type State = keyof typeof ITEM_STATE;
interface RunSearch {
  state?: State;
  node?: string;
  page?: number;
  line?: string;
  view?: 'items' | 'steps';
  lineTab?: 'context';
  aiNode?: string;
}

export const Route = createFileRoute('/p/$projectId/runs/$runId')({
  validateSearch: (raw: Record<string, unknown>): RunSearch => ({
    state: typeof raw.state === 'string' && raw.state in ITEM_STATE ? (raw.state as State) : undefined,
    node: typeof raw.node === 'string' ? raw.node : undefined,
    page: typeof raw.page === 'number' && raw.page > 0 ? raw.page : undefined,
    line: typeof raw.line === 'string' ? raw.line : undefined,
    view: raw.view === 'steps' ? 'steps' : undefined,
    lineTab: raw.lineTab === 'context' ? 'context' : undefined,
    aiNode: typeof raw.aiNode === 'string' && raw.aiNode.includes(':') ? raw.aiNode : undefined,
  }),
  component: RunDetail,
});

const PAGE = 100;

function RunDetail() {
  const { projectId, runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const run = useQuery(q.run(runId));
  const items = useQuery(q.runItems(runId, { state: search.state, nodeId: search.node, offset: (search.page ?? 0) * PAGE }));
  const steps = useQuery({ ...q.runSteps(runId), enabled: search.view === 'steps' });
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'cancel') => unwrap(client.runs[':id'][':action{pause|resume|cancel}'].$post({ param: { id: runId, action } })) });
  const setSearch = (next: Partial<RunSearch>, replace = false) => void navigate({ search: (previous) => ({ ...previous, ...next }), replace });
  useReportView('run', [run.data && { kind: '실행', id: run.data.id, label: `${run.data.workflowName} v${run.data.workflowVersion}` }]);

  if (!run.data) return <Page title="실행">…</Page>;
  const data = run.data;
  const nodeById = new Map<string, WorkflowNode>(data.definition.nodes.map((node) => [node.id, node]));
  const totals = data.nodes.reduce<Record<string, number>>((acc, row) => ((acc[row.state] = (acc[row.state] ?? 0) + row.count), acc), {});
  const finished = (totals.done ?? 0) + (totals.failed ?? 0) + (totals.cancelled ?? 0);
  const byNode = Map.groupBy(data.nodes, (row) => row.nodeId);
  const order = data.definition.nodes.filter((node) => byNode.has(node.id));
  const nodeName = (id: string) => {
    const node = nodeById.get(id);
    return node ? nameOf(node) : id;
  };
  const active = data.status === 'running' || data.status === 'paused';

  return (
    <Page
      title={`${data.workflowName} v${data.workflowVersion}`}
      back={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/p/$projectId/runs" params={{ projectId }}>
            <ChevronLeft /> 실행 기록
          </Link>
        </Button>
      }
      meta={`${new Date(data.createdAt).toLocaleString()} 시작 · 프로필 ${data.profiles.map((profile) => `${profile.name}(${profile.models.join(' → ')})`).join(', ') || '없음'}`}
      actions={
        <>
          <Badge variant={data.status === 'running' ? 'default' : 'outline'}>{RUN_STATUS[data.status]}</Badge>
          {data.status === 'running' && (
            <Button size="sm" variant="outline" onClick={() => control.mutate('pause')}>
              <Pause /> 일시정지
            </Button>
          )}
          {data.status === 'paused' && (
            <Button size="sm" variant="outline" onClick={() => control.mutate('resume')}>
              <Play /> 재개
            </Button>
          )}
          {active && (
            <Button size="sm" variant="outline" onClick={() => control.mutate('cancel')}>
              <Square /> 취소
            </Button>
          )}
        </>
      }
      flush
      className="border-t-0"
    >
      <SplitPane
        id="run-lines"
        defaultWidth="400px"
        className="h-full min-h-0"
        pane={
          search.line && (
            <div className="h-full">
              <LineDetail
                projectId={projectId}
                unitId={search.line}
                onClose={() => setSearch({ line: undefined }, true)}
                showScene
                tab={search.lineTab ?? 'edit'}
                onTab={(tab) => setSearch({ lineTab: tab === 'context' ? 'context' : undefined }, true)}
                aiNode={search.aiNode}
                onAiNode={(aiNode) => setSearch({ aiNode }, true)}
              />
            </div>
          )
        }
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-4 px-6 pt-4 pb-4">
            {data.status === 'paused' && data.notice && (
              <Alert variant="destructive">
                <OctagonAlert />
                <AlertTitle>실행이 멈췄습니다</AlertTitle>
                <AlertDescription>{data.notice} 원인을 확인한 뒤 위의 재개 버튼으로 이어서 실행할 수 있습니다.</AlertDescription>
              </Alert>
            )}
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
              <Progress value={(finished / data.total) * 100} className="h-1.5" />
            </div>
            {/* Where every line is right now, node by node, in workflow order. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
              {order.map((node) => {
                const Icon = nodeIcon(node);
                const rows = byNode.get(node.id)!;
                const selected = search.node === node.id;
                return (
                  <button key={node.id} onClick={() => setSearch({ node: selected ? undefined : node.id, page: undefined })} className="text-left">
                    <Card className={cn('gap-0 py-2.5 transition-colors hover:bg-muted/40', selected && 'ring-2 ring-[color:var(--graph-select)]')}>
                      <CardContent className="px-3">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <Icon className="size-3.5 text-muted-foreground" /> {nodeName(node.id)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{rows.map((row) => `${ITEM_STATE[row.state]} ${row.count}`).join(' · ')}</p>
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={search.view ?? 'items'} onValueChange={(value) => setSearch({ view: value === 'steps' ? 'steps' : undefined }, true)}>
                <TabsList>
                  <TabsTrigger value="items">대사별</TabsTrigger>
                  <TabsTrigger value="steps">AI 호출</TabsTrigger>
                </TabsList>
              </Tabs>
              {(search.view ?? 'items') === 'items' && (
                <Tabs value={search.state ?? 'all'} onValueChange={(value) => setSearch({ state: value === 'all' ? undefined : (value as State), page: undefined })}>
                  <TabsList>
                    <TabsTrigger value="all">전체</TabsTrigger>
                    {(Object.keys(ITEM_STATE) as State[]).filter((state) => totals[state]).map((state) => (
                      <TabsTrigger key={state} value={state}>
                        {ITEM_STATE[state]} {totals[state]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              {search.node && (
                <Button variant="ghost" size="sm" onClick={() => setSearch({ node: undefined })}>
                  노드 필터 해제: {nodeName(search.node)}
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-t">
            {(search.view ?? 'items') === 'items' ? (
              <Table className="min-w-[720px] table-fixed">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-28">화자</TableHead>
                    <TableHead>원문</TableHead>
                    <TableHead>최신 후보</TableHead>
                    <TableHead className="w-40">위치</TableHead>
                    <TableHead className="w-56">판정·지적·오류</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.data?.rows.map((item) => (
                    <TableRow key={item.id} data-state={search.line === item.unitId ? 'selected' : undefined} className="cursor-pointer align-top" onClick={() => setSearch({ line: search.line === item.unitId ? undefined : item.unitId }, true)}>
                      <TableCell className="truncate">{item.speaker ?? '—'}</TableCell>
                      <TableCell className="whitespace-pre-wrap">{item.source}</TableCell>
                      <TableCell className="whitespace-pre-wrap text-muted-foreground">{item.data.candidateText ?? '—'}</TableCell>
                      <TableCell>
                        <p className="text-sm">{nodeName(item.nodeId)}</p>
                        <p className="text-xs text-muted-foreground">
                          {ITEM_STATE[item.state]}
                          {Object.values(item.visits).some((count) => count > 1) && ` · 재방문 ${Math.max(...Object.values(item.visits)) - 1}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {item.error && <p className="text-destructive">{item.error}</p>}
                        {!!item.data.issues?.length && <p className="text-amber-700">{item.data.issues.join(' / ')}</p>}
                        {Object.entries(item.data.outputs ?? {})
                          .filter(([, output]) => typeof output.passed === 'boolean')
                          .map(([nodeId, output]) => (
                            <p key={nodeId} className={output.passed ? 'text-emerald-700' : 'text-amber-700'}>
                              {nodeName(nodeId)} {output.passed ? '통과' : '실패'}
                            </p>
                          ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <ul className="divide-y">
                {steps.data?.map((step) => (
                  <li key={step.id} className="px-6 py-3 text-sm">
                    <Collapsible>
                      <CollapsibleTrigger className="group flex w-full items-center gap-3 text-left">
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
                        <span className="w-32 truncate font-medium">{nodeName(step.nodeId)}</span>
                        <Badge variant={step.ok ? 'outline' : 'destructive'}>{step.ok ? '성공' : '실패'}</Badge>
                        <span className="text-muted-foreground">대사 {step.unitIds.length}</span>
                        <span className="text-muted-foreground">{[data.profiles.find((profile) => profile.id === step.profileId)?.name, step.model].filter(Boolean).join(' · ')}</span>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                          {((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s
                          {step.inputTokens != null && ` · 입력 ${step.inputTokens.toLocaleString()}${step.cachedInputTokens ? `(캐시 ${step.cachedInputTokens.toLocaleString()})` : ''} · 출력 ${(step.outputTokens ?? 0).toLocaleString()}`}
                          {step.costUsd != null && ` · $${step.costUsd.toFixed(4)}`}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2 pl-7">
                        {step.error && <p className="text-destructive">{step.error}</p>}
                        {Array.isArray(step.attempts) && step.attempts.length > 1 && (
                          <p className="text-xs text-muted-foreground">시도: {(step.attempts as { model: string; ok: boolean; error?: string }[]).map((attempt) => `${attempt.model} ${attempt.ok ? '성공' : `실패(${attempt.error})`}`).join(' → ')}</p>
                        )}
                        {Array.isArray(step.context) && (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">
                              넣은 문맥 {step.context.filter((item) => item.included).length}개
                              {step.context.some((item) => !item.included) && ` · 상한 초과로 뺀 것 ${step.context.filter((item) => !item.included).length}개`}
                            </summary>
                            <div className="mt-2">
                              <ContextItemList items={step.context} />
                            </div>
                          </details>
                        )}
                        {step.prompt && (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">보낸 프롬프트(문맥 포함)</summary>
                            <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted/50 p-2 text-[11px] whitespace-pre-wrap">{step.prompt}</pre>
                          </details>
                        )}
                        {step.output != null && (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">응답</summary>
                            <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted/50 p-2 text-[11px]">{JSON.stringify(step.output, null, 2)}</pre>
                          </details>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </li>
                ))}
                {steps.data?.length === 0 && <li className="px-6 py-6 text-sm text-muted-foreground">아직 AI 호출이 없습니다.</li>}
              </ul>
            )}
          </div>
          {(search.view ?? 'items') === 'items' && (items.data?.total ?? 0) > PAGE && (
            <div className="flex items-center justify-end gap-2 border-t px-6 py-2">
              <Button variant="outline" size="sm" disabled={!search.page} onClick={() => setSearch({ page: (search.page ?? 0) - 1 || undefined })}>
                <ChevronLeft /> 이전
              </Button>
              <span className="text-sm tabular-nums">
                {(search.page ?? 0) + 1} / {Math.ceil((items.data?.total ?? 0) / PAGE)}
              </span>
              <Button variant="outline" size="sm" disabled={((search.page ?? 0) + 1) * PAGE >= (items.data?.total ?? 0)} onClick={() => setSearch({ page: (search.page ?? 0) + 1 })}>
                다음 <ChevronRight />
              </Button>
            </div>
          )}
        </div>
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
