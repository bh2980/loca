import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, CircleStop, Hourglass, OctagonAlert, Pause, Play } from 'lucide-react';
import { nodePorts, runNodeName, type WorkflowNode, INPUT_TYPES, bySubject, type Subject } from '@loca/shared';
import { parseExitKey } from '@/components/workflow/exit-marks';
import { ContextItemList } from '@/components/ai-context';
import { LineDetail } from '@/components/line-detail';
import { TermEditor } from '@/components/glossary/term-pane';
import { HeaderActions, HeaderViews, Page } from '@/components/page';
import { Inspector, InspectorHeader, Group, KeyValue, KeyValueRow, Section, EmptyState, SectionHeading, DataTable, type ColumnDef, Pager, FilterBar, ActionBar, SplitPane, RunStatusBadge, StatusBarItem, Notice, NoticeDescription, NoticeRow, Chip, Box, Button, Inline, Text, ExpandableRow, Progress, Tabs, TabsList, TabsTrigger, Skeleton, ConfirmDialog } from '@loca/ui';
import { HeaderFilter } from '@/components/header-filter';
import { ITEM_STATE } from '@/lib/labels';
import { errorKindLabel, retryReason, retryState } from '@/lib/retry-info';
import { q } from '@/lib/queries';
import { useListScreen } from '@/lib/list-screen';
import { BatchList } from '@/components/workflow/batch-list';
import { ContinueRun } from '@/components/workflow/continue-run';
import { RaiseCaps } from '@/components/workflow/raise-caps';
import { RunGraph } from '@/components/workflow/run-graph';
import { topCallIds } from '@/components/workflow/run-calls';
import { dateTime } from '@/lib/datetime';
import { useTerms } from '@/lib/terms';
import { runNodeExits, useRunDetail, useRunItems, useRunSteps, type RunItemRow } from '@/lib/run-detail';
import { controlRun } from '@/lib/runs';
import { useRunNotices } from '@/lib/run-notices';
import { decideItems } from '@/lib/knowledge';
import { param, searchParams } from '@/lib/search';

type State = keyof typeof ITEM_STATE | 'retrying';
const runSearchParams = {
  /** The open inspector's tab (lib/inspector-tab.ts). */
  pane: param.text,
  state: param.oneOf<State>([...(Object.keys(ITEM_STATE) as (keyof typeof ITEM_STATE)[]), 'retrying']),
  /** Where the lines are now (the 위치 column's filter). */
  node: param.text,
  /** The lines that came through a node (the run graph opens these), and out of which of its exits. */
  through: param.text,
  exit: param.text,
  page: param.positive,
  line: param.text,
  tab: param.oneOf(['steps', 'plan', 'graph']),
  aiNode: param.read((raw) => (typeof raw === 'string' && raw.includes(':') ? raw : undefined)),
};

export const Route = createFileRoute('/p/$projectId/runs/$runId')({
  validateSearch: searchParams(runSearchParams),
  component: RunDetail,
});

const PAGE = 100;

type Item = RunItemRow;

/** A page part that could not be read, and a way to ask again: never a skeleton that goes on forever. */
function ReadFailed({ title, message, onRetry }: { title: string; message?: string; onRetry: () => void }) {
  return (
    <Box padding="comfortable">
      <Notice tone="danger" icon={<OctagonAlert />} title={title}>
        {message && <NoticeDescription>{message}</NoticeDescription>}
        <NoticeRow><Button variant="outline" onClick={onRetry}>다시 시도</Button></NoticeRow>
      </Notice>
    </Box>
  );
}

function RunDetail() {
  const [continueOpen, setContinueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { projectId, runId } = Route.useParams();
  const { markRead } = useRunNotices(projectId);
  useEffect(() => markRead(runId), [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const run = useRunDetail(projectId, runId);
  const items = useRunItems(projectId, runId, { state: search.state, nodeId: search.node, through: search.through, exit: search.through ? search.exit : undefined, offset: (search.page ?? 0) * PAGE });
  const nodeExits = useQuery({ ...runNodeExits(runId, search.through ?? ''), enabled: Boolean(search.through) });
  const subject: Subject = items.data?.subject ?? 'lines';
  const input = INPUT_TYPES[subject];
  // The page has two forms: a run on lines (items are script lines, with a translation plan) and one on glossary terms (the detail is the term).
  const terms = bySubject(subject, { lines: false, terms: true });
  const termList = useTerms(projectId, { enabled: terms && Boolean(search.line) });
  const selectedTerm = terms ? termList.data?.find((term) => term.id === search.line) : undefined;
  const decide = useMutation({
    mutationFn: (accept: boolean) => decideItems(projectId, [{ kind: 'terms', ids: [search.line!] }], accept ? 'confirm' : 'discard'),
    onError: (error) => toast.error(error.message),
  });
  const steps = useRunSteps(projectId, runId, search.tab === 'steps');
  const plan = useQuery({ ...q.runPlan(runId), enabled: search.tab === 'plan' });
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'cancel') => controlRun(projectId, runId, action) });
  const { setSearch, toggle } = useListScreen({ search, navigate, selection: 'line', report: ['run', [run.data && { kind: '실행', id: run.data.id, label: run.data.workflowName }]] });

  if (!run.data)
    return (
      <Page title="실행" flush>
        {run.isError ? <ReadFailed title="실행을 불러오지 못했습니다" message={run.error?.message ?? ""} onRetry={() => void run.refetch()} /> : (
          <Box spaceY="normal" padding="comfortable">
            <Skeleton height="control" width="1/2" />
            <Skeleton height="placeholder-sm" />
            <Skeleton height="placeholder-md" />
          </Box>
        )}
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
  // A run whose lines are still being stored (preparing) can only be cancelled; it starts by itself once they are in.
  const active = data.status === 'preparing' || data.status === 'running' || data.status === 'paused';
  const total = items.data?.total ?? 0;
  const filtered = Boolean(search.state || search.node || search.through);
  const noun = input.label;
  const exitLabel = (port: string) => {
    const node = search.through ? nodeById.get(search.through) : undefined;
    return (node && nodePorts(node).find((item) => item.id === port)?.label) ?? (port === 'retry' ? '다시 보냄' : port);
  };

  const columns: ColumnDef<Item, unknown>[] = [
    ...(terms ? [] : [{ id: 'speaker', header: '화자', meta: { width: 112 }, cell: ({ row }) => row.original.speaker ?? '—' } satisfies ColumnDef<Item, unknown>]),
    { id: 'source', header: '원문', meta: { wrap: true, hideable: false }, cell: ({ row }) => row.original.source },
    ...(terms ? [{ id: 'target', header: '현재 표기', meta: { wrap: true }, cell: ({ row }) => row.original.target || '—' } satisfies ColumnDef<Item, unknown>] : []),
    { id: 'candidate', header: '최신 후보', meta: { wrap: true, tone: 'muted' }, cell: ({ row }) => row.original.data.candidateText ?? '—' },
    {
      id: 'node',
      header: () => (
        <HeaderFilter
          label="위치"
          value={search.node}
          onChange={(node) => setSearch({ node, page: undefined, line: undefined })}
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
          onChange={(state) => setSearch({ state: state as State | undefined, page: undefined, line: undefined })}
          options={[
            ...(Object.keys(ITEM_STATE) as (keyof typeof ITEM_STATE)[]).filter((state) => totals[state]).map((state) => ({ value: state, label: ITEM_STATE[state], hint: totals[state] })),
            ...(retryingTotal || search.state === 'retrying' ? [{ value: 'retrying', label: '다시 보내는 중', hint: retryingTotal }] : []),
          ]}
        />
      ),
      meta: { width: 128, label: '상태' },
      cell: ({ row }) => (
        <>
          {row.original.retry ? <Text variant="caption">{retryState(row.original.retry.times, row.original.retry.max)}</Text> : ITEM_STATE[row.original.state]}
          {row.original.state === 'done' && row.original.statusName && <Text tone="muted"> → {row.original.statusName}</Text>}
          {Object.values(row.original.visits).some((count) => count > 1) && <Text variant="caption" tone="muted"> · 재방문 {Math.max(...Object.values(row.original.visits)) - 1}</Text>}
        </>
      ),
    },
    {
      id: 'verdict',
      header: '결과',
      meta: { width: 220, wrap: true, variant: 'caption' },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <>
            {item.retry && <Text as="p" tone="muted" title={item.retry.message}>{retryReason(item.retry)}</Text>}
            {item.error && <Text as="p" tone="danger">{item.error}</Text>}
            {!!item.data.issues?.length && <Text as="p" tone="warning">{item.data.issues.join(' / ')}</Text>}
            {!!item.data.notes?.length && <Text as="p" tone="muted">{item.data.notes.join(' / ')}</Text>}
            {Object.entries(item.data.outputs ?? {})
              .filter(([, output]) => typeof output.passed === 'boolean')
              .map(([nodeId, output]) => (
                <Text as="p" key={nodeId} tone={output.passed ? 'success' : 'warning'}>
                  {nodeName(nodeId)} {output.passed ? '통과' : '실패'}
                </Text>
              ))}
            {Object.entries(item.data.outputs ?? {})
              .filter(([, output]) => 'confidence' in output && 'value' in output)
              .map(([nodeId, output]) => (
                <Text as="p" key={`choice:${nodeId}`} tone="muted">
                  {nodeName(nodeId)}: {output.value == null ? '해당 없음' : String(output.value)} (확신도 {Number(output.confidence).toFixed(2)})
                </Text>
              ))}
          </>
        );
      },
    },
  ];

  const stop = (
    <ConfirmDialog
      open={cancelOpen}
      onOpenChange={setCancelOpen}
      title="실행을 취소할까요?"
      description={`아직 처리하지 않은 ${INPUT_TYPES[data.subject].label}는 이 실행에서 빠집니다. 이미 반영된 번역·상태는 그대로입니다.`}
      cancelLabel="계속 실행"
      confirmLabel="실행 취소"
      onConfirm={() => control.mutate('cancel')}
    />
  );

  const percent = data.total ? Math.round((finished / data.total) * 100) : 0;
  const exitNotes = Object.entries(data.exits ?? {}).flatMap(([at, exit]) => {
    const where = parseExitKey(at);
    const node = where && data.definition.nodes.find((item) => item.id === where.nodeId);
    const port = node && nodePorts(node).find((item) => item.id === where!.port);
    return Object.entries(exit.notes).map(([note, count]) => ({ at, note, count, where: `${node ? nodeName(node.id) : at} · ${port?.label ?? where?.port ?? ''}` }));
  });
  const runInfo = (
    <Inspector header={<InspectorHeader kind="실행" name={data.workflowName} status={<RunStatusBadge status={data.status} />} />}>
      <Section title="진행">
        <Box spaceY="condensed">
          <Text as="p" variant="body" tabular>
            <Text as="b">{finished.toLocaleString()}</Text>
            <Text tone="muted"> / {data.total.toLocaleString()} {input.label} 처리 · {percent}%</Text>
          </Text>
          <Progress value={percent} />
        </Box>
        {data.usage && (
          <KeyValue>
            <KeyValueRow label="AI 호출"><Text tabular>{data.usage.steps.toLocaleString()}회{data.usage.failed ? ` · 실패 ${data.usage.failed}` : ''}</Text></KeyValueRow>
            <KeyValueRow label="입력 토큰"><Text tabular>{data.usage.inputTokens.toLocaleString()}{data.usage.cachedInputTokens > 0 && ` (캐시 ${data.usage.cachedInputTokens.toLocaleString()})`}</Text></KeyValueRow>
            <KeyValueRow label="출력 토큰"><Text tabular>{data.usage.outputTokens.toLocaleString()}</Text></KeyValueRow>
            {data.usage.costUsd != null && <KeyValueRow label="보고된 비용"><Text tabular>${data.usage.costUsd.toFixed(4)}</Text></KeyValueRow>}
            {(data.limits?.maxCalls != null || data.limits?.maxInputTokens != null) && (
              <KeyValueRow label="상한">
                <Text tabular>{[data.limits?.maxCalls != null && `호출 ${data.limits.maxCalls.toLocaleString()}회`, data.limits?.maxInputTokens != null && `입력 ${data.limits.maxInputTokens.toLocaleString()}`].filter(Boolean).join(' · ')}</Text>
              </KeyValueRow>
            )}
          </KeyValue>
        )}
      </Section>
      {exitNotes.length > 0 && (
        // What exit actions could not do (a person's status kept, a tag name no tag has), by exit: counted once, not per line.
        <Section title="출구 동작 알림" count={exitNotes.length}>
          <KeyValue>
            {exitNotes.map((entry) => (
              <KeyValueRow key={`${entry.at}:${entry.note}`} label={entry.where}>
                <Text breakWords>{entry.note} <Text tone="muted" tabular>{entry.count.toLocaleString()}{input.unit}</Text></Text>
              </KeyValueRow>
            ))}
          </KeyValue>
        </Section>
      )}
      <Section title="실행">
        <KeyValue>
          <KeyValueRow label="실행 ID">
            <Inline as="span" align="start" gap="tight" minWidth={0}>
              <Text as="code" minWidth={0} grow paddingTop="tight" mono variant="caption" breakWords="all" tone="muted">{runId}</Text>
              <CopyButton value={runId} label="실행 ID 복사" tip={runId} />
            </Inline>
          </KeyValueRow>
          <KeyValueRow label="시작">{dateTime(data.createdAt)}</KeyValueRow>
          <KeyValueRow label="모델">{data.models.map((model) => model.label).join(', ') || '없음'}</KeyValueRow>
          {data.byModel.length > 1 && (
            <KeyValueRow label="연결별 호출">
              {data.byModel.map((row) => `${[row.name, row.model].filter(Boolean).join(' · ') || '알 수 없음'} ${row.steps}회${row.failed ? `(실패 ${row.failed})` : ''}`).join(', ')}
            </KeyValueRow>
          )}
        </KeyValue>
        {data.continuations.map((entry, index) => (
          <Text as="p" key={index} variant="caption" tone="muted">
            {dateTime(entry.at)} 이어서 실행{entry.changes.length > 0 && ` · ${entry.changes.map((change) => `${nodeName(change.nodeId)}: ${change.from} → ${change.to}`).join(', ')}`}
            {entry.retried > 0 && ` · 실패한 줄 ${entry.retried.toLocaleString()}개 다시`}
          </Text>
        ))}
      </Section>
    </Inspector>
  );

  // A node of the run graph: what came through it and how it left, each exit opening its lines.
  const nodeInfo = search.through && (
    <Inspector header={<InspectorHeader kind="노드" name={nodeName(search.through)} />}>
      <Section title={`이 노드를 거친 ${noun}`}>
        {nodeExits.isError ? <Text as="p" variant="caption" tone="danger">{nodeExits.error.message}</Text> : (
          <KeyValue>
            <KeyValueRow label="도착"><Text tabular>{nodeExits.data ? `${nodeExits.data.arrived.toLocaleString()}${input.unit}` : '…'}</Text></KeyValueRow>
            {(nodeExits.data?.here ?? 0) > 0 && <KeyValueRow label="지금 여기"><Text tabular>{nodeExits.data!.here.toLocaleString()}{input.unit}</Text></KeyValueRow>}
          </KeyValue>
        )}
      </Section>
      {(nodeExits.data?.exits.length ?? 0) > 0 && (
        <Section title="나간 출구">
          <Box as="ul" spaceY="tight">
            {nodeExits.data!.exits.map((exit) => (
              <Box as="li" key={exit.port}>
                <Button variant={search.exit === exit.port ? 'secondary' : 'ghost'} height="auto" width="full" justifyContent="between" gap="condensed" paddingY="tight" weight="normal" aria-pressed={search.exit === exit.port} title={`이 출구로 나간 ${noun} 보기`} onClick={() => setSearch({ exit: search.exit === exit.port ? undefined : exit.port, page: undefined })}>
                  <Text minWidth={0} truncate align="start">{exitLabel(exit.port)}</Text>
                  <Text shrink={false} variant="caption" tone="muted" tabular>{exit.count.toLocaleString()}</Text>
                </Button>
              </Box>
            ))}
          </Box>
        </Section>
      )}
    </Inspector>
  );

  return (
    <Page title={data.workflowName} flush back={<Button variant="ghost" asChild><Link to="/p/$projectId/runs" params={{ projectId }}><ChevronLeft /> 실행 기록</Link></Button>}>
      <SplitPane fill="height"
        id="run-lines" selectionKey={search.line ?? search.through}
        defaultWidth="400px"
        pane={
          !search.line ? (nodeInfo || runInfo) : (terms ? (
            selectedTerm ? (
              <TermEditor key={selectedTerm.id} projectId={projectId} term={selectedTerm} onClose={() => setSearch({ line: undefined })} onDecide={(accept) => decide.mutate(accept)} deciding={decide.isPending} />
            ) : (
              <Text as="p" padding="comfortable" variant="body" tone="muted">{Boolean(termList.data) ? '용어집에서 사라진 용어입니다.' : '용어를 불러오는 중…'}</Text>
            )
          ) : (
            <LineDetail
              projectId={projectId}
              unitId={search.line}
              onClose={() => setSearch({ line: undefined })}
              showScene
              editor
              aiNode={search.aiNode}
              onAiNode={(aiNode) => setSearch({ aiNode })}
            />
          ))
        }
      >
        {/* The views next to the title (as every page's); the run's actions stay at the right. */}
        <HeaderViews>
          <Box asChild alignSelf="stretch">
          <Tabs value={view} onValueChange={(value) => setSearch({ tab: value === 'steps' || value === 'plan' || value === 'graph' ? value : undefined })}>
            <Box asChild height="full" border="noBottom">
            <TabsList variant="line" aria-label="보기">
              <TabsTrigger value="items">{input.label}별 <Text tone="muted" tabular>{data.total.toLocaleString()}</Text></TabsTrigger>
              <TabsTrigger value="graph">그래프</TabsTrigger>
              <TabsTrigger value="steps">AI 호출</TabsTrigger>
              {/* Terms are not planned in scene batches: there is no plan to show. */}
              {!terms && <TabsTrigger value="plan">번역 계획</TabsTrigger>}
            </TabsList>
            </Box>
          </Tabs>
          </Box>
        </HeaderViews>
        <HeaderActions>
          {data.status === 'running' && <Button onClick={() => control.mutate('pause')}><Pause /> 일시정지</Button>}
          {data.status === 'paused' && <Button variant={data.limits?.hit ? 'outline' : 'default'} onClick={() => control.mutate('resume')}><Play /> 재개</Button>}
          {data.status === 'completed' && (totals.failed ?? 0) > 0 && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused={false} limits={data.limits ?? undefined} />}
          {(active || data.status === 'paused') && <ActionBar aria-label="실행 동작" items={[
            ...(active ? [{ id: 'cancel', label: '실행 취소', icon: <CircleStop />, destructive: true, onSelect: () => setCancelOpen(true) }] : []),
            ...(data.status === 'paused' ? [{ id: 'continue', label: '모델 바꿔 재개', icon: <Play />, onSelect: () => setContinueOpen(true) }] : []),
          ]} />}
        </HeaderActions>
        {data.status === 'paused' && <ContinueRun runId={runId} failed={totals.failed ?? 0} paused limits={data.limits ?? undefined} hideTrigger open={continueOpen} onOpenChange={setContinueOpen} />}
        {active && stop}
        <StatusBarItem><RunStatusBadge status={data.status} /></StatusBarItem>
        {/* Only a filter (a state or node picked elsewhere) earns a bar: it says how many it left and takes it off. The run's count is on the tab. */}
        {view === 'items' && filtered && <FilterBar end={items.data ? <Text variant="micro" tabular>{total.toLocaleString()}{input.unit}</Text> : undefined}>
          {search.through && <Text minWidth={0} truncate variant="caption">‘{nodeName(search.through)}’ 노드를 거친 {noun}{search.exit ? ` · 출구 ${exitLabel(search.exit)}` : ''}</Text>}
          <Button variant="ghost" onClick={() => setSearch({ state: undefined, node: undefined, through: undefined, exit: undefined, page: undefined, line: undefined })}>
            필터 지우기
          </Button>
        </FilterBar>}

        {data.status === 'preparing' && (
          <Box shrink={false} border="bottom" paddingX="comfortable" paddingY="normal">
            <Notice icon={<Hourglass />} title="실행을 준비하는 중입니다">
              <NoticeDescription>{noun}를 넣고 있습니다. 다 넣으면 바로 시작합니다.</NoticeDescription>
            </Notice>
          </Box>
        )}
        {data.status === 'cancelled' && data.notice && (
          <Box shrink={false} border="bottom" paddingX="comfortable" paddingY="normal">
            <Notice tone="danger" icon={<OctagonAlert />} title="실행이 시작되지 못했습니다">
              <NoticeDescription>{data.notice}</NoticeDescription>
            </Notice>
          </Box>
        )}
        {data.status === 'paused' && data.notice && (
          <Box shrink={false} border="bottom" paddingX="comfortable" paddingY="normal">
            <Notice tone="danger" icon={<OctagonAlert />} title="실행이 멈췄습니다">
              <NoticeDescription>{data.notice}</NoticeDescription>
              {data.limits?.hit && <RaiseCaps key={`${data.limits.maxCalls}-${data.limits.maxInputTokens}`} projectId={projectId} runId={runId} limits={data.limits} />}
            </Notice>
          </Box>
        )}

        {view === 'items' ? (items.failed && !items.data ? <ReadFailed title={`${noun}를 불러오지 못했습니다`} onRetry={items.retry} /> : (
          <DataTable id="run-items"
            columns={columns}
            rows={items.data?.rows}
            rowId={(item) => item.id}
            loading={!items.data}
            selected={items.data?.rows.find((item) => item.unitId === search.line)?.id}
            onRowClick={(item) => toggle(item.unitId)}
            empty={search.through && !search.exit && !search.state && !search.node
              ? <EmptyState noun={noun} hint="아직 이 노드에 도착하지 않았습니다." />
              : <EmptyState noun={noun} filtered={filtered} />}
            footer={<Pager page={search.page ?? 0} total={total} pageSize={PAGE} onPage={(page) => setSearch({ page: page || undefined }, 'push')} />}
          />
        )) : view === 'graph' ? (
          <Box minHeight={0} grow>
            <RunGraph projectId={projectId} run={data} selected={search.through ?? search.node} onOpenNode={(through) => setSearch({ tab: undefined, through, exit: undefined, node: undefined, state: undefined, page: undefined, line: undefined }, 'push')} />
          </Box>
        ) : view === 'plan' ? (
          <Box minHeight={0} grow overflow="auto" padding="comfortable">
            {plan.data ? (
              plan.data.total ? (
                <>
                  <SectionHeading marginBottom="normal">번역 계획</SectionHeading>
                  <BatchList list={plan.data} />
                </>
              ) : (
                <EmptyState noun="저장된 번역 계획" />
              )
            ) : plan.isError ? (
              <Text as="p" paddingY="section" align="center" variant="body" tone="danger">번역 계획을 불러오지 못했습니다: {plan.error.message}</Text>
            ) : (
              <Skeleton height="placeholder-md" width="full" />
            )}
          </Box>
        ) : (
          <Box minHeight={0} grow overflow="auto">
            {!steps.data ? (
              <Box spaceY="normal" padding="comfortable">
                <Skeleton height="icon" width="2/3" />
                <Skeleton height="icon" width="1/2" />
                <Skeleton height="icon" width="3/4" />
              </Box>
            ) : (
              <ul>
                {steps.data.map((step) => (
                  <Box as="li" key={step.id} paddingX="comfortable" paddingY="condensed" variant="body">
                    <ExpandableRow
                      summary={<>{/* The spaces keep the row's words apart when read or copied (#48); the flex gap already spaces them on screen. */}
                          <Text width="field" truncate align="start" weight="medium">{nodeName(step.nodeId)}</Text>{' '}
                          <Chip variant={step.ok ? 'outline' : 'solid'} tone={step.ok ? undefined : 'danger'}>{step.ok ? '성공' : '실패'}</Chip>{' '}
                          {!step.ok && errorKindLabel(step.errorKind) && <Chip variant="outline">{errorKindLabel(step.errorKind)}</Chip>}{' '}
                          <Text tone="muted">{`${input.label} ${step.subjectIds.length}${input.unit}`}</Text>{' '}
                          <Text minWidth={0} truncate tone="muted">{[data.models.find((model) => model.connectionId === step.connectionId)?.name, step.model].filter(Boolean).join(' · ')}</Text>
                          {' '}
                      </>}
                      meta={<>{((new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1)}s
                            {step.inputTokens != null && ` · 입력 ${step.inputTokens.toLocaleString()}${step.cachedInputTokens ? `(캐시 ${step.cachedInputTokens.toLocaleString()})` : ''} · 출력 ${(step.outputTokens ?? 0).toLocaleString()}`}
                            {step.costUsd != null && ` · $${step.costUsd.toFixed(4)}`}</>}
                    >
                      <Box spaceY="condensed">
                        {step.error && <Text as="p" tone="danger">{[errorKindLabel(step.errorKind), step.error].filter(Boolean).join(' · ')}</Text>}
                        {Array.isArray(step.context) && (
                          <Group
                            title="넣은 문맥"
                            count={`${step.context.filter((item) => item.included).length}개${step.context.some((item) => !item.included) ? ` · 상한 초과 ${step.context.filter((item) => !item.included).length}` : ''}`}
                            collapsible
                            persistKey="run.step.context"
                          >
                            <ContextItemList items={step.context} />
                          </Group>
                        )}
                        {step.prompt && (
                          <Group title="보낸 프롬프트" collapsible persistKey="run.step.prompt">
                              <Box as="pre" maxHeight="scroll-lg" overflow="auto" radius="base" background="sunken" padding="condensed" variant="caption" preserveLines>{step.prompt}</Box>
                          </Group>
                        )}
                        {step.output != null && (
                          <Group title="응답" collapsible persistKey="run.step.response">
                              <Box as="pre" maxHeight="scroll-lg" overflow="auto" radius="base" background="sunken" padding="condensed" variant="caption">{JSON.stringify(step.output, null, 2)}</Box>
                          </Group>
                        )}
                      </Box>
                    </ExpandableRow>
                  </Box>
                ))}
                {steps.data.length === 0 && <Text as="li" paddingX="comfortable" paddingY="spacious" variant="body" tone="muted">아직 AI 호출이 없습니다.</Text>}
              </ul>
            )}
          </Box>
        )}
      </SplitPane>
      {data.workflowId && (
        <Text as="p" srOnly>
          <Link to="/p/$projectId/workflows/$workflowId" params={{ projectId, workflowId: data.workflowId }}>
            워크플로 열기
          </Link>
        </Text>
      )}
    </Page>
  );
}
